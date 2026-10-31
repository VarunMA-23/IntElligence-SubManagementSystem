import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  type TenantContext,
} from "@brightloop/shared";
import {
  AddOn,
  AppliedCoupon,
  Coupon,
  Customer,
  Plan,
  PlanVersion,
  PriceComponent,
  Subscription,
  SubscriptionAddOn,
  SubscriptionComponent,
  SubscriptionEvent,
} from "@brightloop/db";
import { addBillingPeriod, type BillingPeriod } from "@brightloop/billing";
import {
  emitEvent,
  recordActivity,
  resolveActivePlanVersion,
  resolveCustomer,
} from "../lib/domain.js";
import { withTransaction } from "../lib/transaction.js";

export async function createSubscription(ctx: TenantContext, input: any) {
  const { plan, version } = await resolveActivePlanVersion(ctx.tenantId, input.plan_id);
  const customer = await resolveCustomer(ctx.tenantId, input.customer_id_or_alias);
  if (customer.archivedAt) throw new ConflictError("Archived customers cannot be subscribed");

  const components = await PriceComponent.find({ tenantId: ctx.tenantId, planVersionId: String(version._id) }).sort({
    order: 1,
  });
  if (!components.length) throw new ConflictError("Plan version has no price components");

  const startDate = input.start_date ? new Date(input.start_date) : new Date();
  if (Number.isNaN(startDate.getTime())) throw new BadRequestError("start_date is invalid");
  const customerStart = new Date(customer.createdAt);
  customerStart.setUTCHours(0, 0, 0, 0);
  if (startDate < customerStart) {
    throw new BadRequestError("start_date cannot be before the customer was created");
  }

  const addOns: Array<{ addOn: any; quantity: number }> = [];
  for (const requested of input.add_ons ?? []) {
    const addOn = await AddOn.findOne({ _id: requested.add_on_id, tenantId: ctx.tenantId });
    if (!addOn) throw new NotFoundError("Add-on");
    if (addOn.archivedAt) throw new ConflictError(`Add-on ${addOn.name} is archived`);
    if (addOn.maxInstancesPerSubscription && requested.quantity > addOn.maxInstancesPerSubscription) {
      throw new ConflictError(`Add-on ${addOn.name} exceeds its maximum instances`);
    }
    addOns.push({ addOn, quantity: requested.quantity });
  }

  const coupons: any[] = [];
  for (const code of input.coupon_codes ?? []) {
    const coupon = await Coupon.findOne({ tenantId: ctx.tenantId, code });
    if (!coupon) throw new ConflictError(`Coupon ${code} was not found`);
    if (coupon.disabled) throw new ConflictError(`Coupon ${code} is disabled`);
    if (coupon.archivedAt) throw new ConflictError(`Coupon ${code} is archived`);
    if (coupon.expiresAt && coupon.expiresAt.getTime() <= Date.now()) {
      throw new ConflictError(`Coupon ${code} has expired`);
    }
    if (coupon.planIds.length && !coupon.planIds.includes(input.plan_id)) {
      throw new ConflictError(`Coupon ${code} does not apply to this plan`);
    }
    if (coupon.redemptionLimit && coupon.redemptionCount >= coupon.redemptionLimit) {
      throw new ConflictError(`Coupon ${code} has reached its redemption limit`);
    }
    if (!coupon.reusable && coupon.redemptionCount >= 1) {
      throw new ConflictError(`Coupon ${code} has already been used`);
    }
    coupons.push(coupon);
  }

  const trialDays = input.trial_days ?? 0;
  const trialEndsAt = trialDays > 0 ? new Date(startDate.getTime() + trialDays * 86_400_000) : null;
  let status = trialDays > 0 ? "TRIAL_ACTIVE" : "ACTIVE";
  if (input.activation_condition === "ON_CHECKOUT") status = "PENDING_ACTIVATION";
  const periodEnd = addBillingPeriod(startDate, plan.billingPeriod as BillingPeriod);

  const subscription = await withTransaction(async (session) => {
    const [created] = await Subscription.create(
      [
        {
          tenantId: ctx.tenantId,
          customerId: String(customer._id),
          planId: String(plan._id),
          planVersionId: String(version._id),
          status,
          startDate,
          endDate: null,
          billingStartDate: trialEndsAt ?? startDate,
          currentPeriodStart: startDate,
          currentPeriodEnd: periodEnd,
          billingDayAnchor: input.billing_day_anchor ?? 1,
          currency: plan.currency,
          netTerms: input.net_terms ?? plan.netTerms ?? 30,
          trialEndsAt,
          autoAdvanceInvoices: input.auto_advance_invoices ?? true,
          chargeAutomatically: input.charge_automatically ?? false,
          purchaseOrder: input.purchase_order ?? null,
          invoiceMemo: input.invoice_memo ?? null,
        },
      ],
      session ? { session } : undefined,
    );

    await SubscriptionComponent.create(
      components.map((component) => ({
        tenantId: ctx.tenantId,
        subscriptionId: String(created._id),
        priceComponentId: String(component._id),
        quantity: 1,
        overrides: null,
      })) as any,
      session ? { session } : undefined,
    );

    if (addOns.length) {
      await SubscriptionAddOn.create(
        addOns.map((entry) => ({
          tenantId: ctx.tenantId,
          subscriptionId: String(created._id),
          addOnId: String(entry.addOn._id),
          quantity: entry.quantity,
        })) as any,
        session ? { session } : undefined,
      );
    }

    for (const coupon of coupons) {
      const filter: Record<string, unknown> = { _id: coupon._id, tenantId: ctx.tenantId };
      if (!coupon.reusable) filter.redemptionCount = 0;
      if (coupon.redemptionLimit) filter.redemptionCount = { $lt: coupon.redemptionLimit };
      const updated = await Coupon.findOneAndUpdate(
        filter,
        { $inc: { redemptionCount: 1 } },
        { new: true, session: session ?? undefined },
      );
      if (!updated) throw new ConflictError(`Coupon ${coupon.code} is no longer available`);
      await AppliedCoupon.create(
        [
          {
            tenantId: ctx.tenantId,
            subscriptionId: String(created._id),
            couponId: String(coupon._id),
            status: "active",
          },
        ],
        session ? { session } : undefined,
      );
    }

    await SubscriptionEvent.create(
      [
        {
          tenantId: ctx.tenantId,
          subscriptionId: String(created._id),
          type: "subscription.created",
          payload: { status, planId: String(plan._id), planVersionId: String(version._id) },
        },
      ],
      session ? { session } : undefined,
    );

    await emitEvent(
      ctx,
      "subscription.created",
      {
        subscriptionId: String(created._id),
        customerId: String(customer._id),
        planId: String(plan._id),
        status,
      },
      session,
    );

    return created;
  });

  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "subscription",
    entityId: String(subscription._id),
    action: "created",
    actorId: ctx.actorId,
    diff: { status, planId: String(plan._id) },
  });

  return subscription;
}

export async function cancelSubscription(ctx: TenantContext, subscriptionId: string, input: any) {
  const subscription = await Subscription.findOne({ _id: subscriptionId, tenantId: ctx.tenantId });
  if (!subscription) throw new NotFoundError("Subscription");
  if (["CANCELLED", "COMPLETED", "SUPERSEDED"].includes(subscription.status)) {
    throw new ConflictError(`Subscription is already ${subscription.status.toLowerCase()}`);
  }
  const effectiveDate = input.effective_date
    ? new Date(input.effective_date)
    : subscription.currentPeriodEnd ?? new Date();
  if (Number.isNaN(effectiveDate.getTime())) throw new BadRequestError("effective_date is invalid");
  const now = new Date();
  subscription.canceledAt = now;
  subscription.cancellationReason = input.reason ?? null;
  subscription.endDate = effectiveDate;
  if (effectiveDate.getTime() <= now.getTime()) {
    subscription.status = "CANCELLED";
    subscription.endDate = now;
  }
  await subscription.save();
  await SubscriptionEvent.create({
    tenantId: ctx.tenantId,
    subscriptionId: String(subscription._id),
    type: "subscription.canceled",
    payload: { effectiveDate, reason: input.reason ?? null },
  });
  await emitEvent(ctx, "subscription.canceled", {
    subscriptionId: String(subscription._id),
    effectiveDate,
    immediate: subscription.status === "CANCELLED",
  });
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "subscription",
    entityId: String(subscription._id),
    action: "canceled",
    actorId: ctx.actorId,
    diff: { effectiveDate },
  });
  return subscription;
}

export async function updateSubscription(ctx: TenantContext, subscriptionId: string, input: any) {
  const subscription = await Subscription.findOne({ _id: subscriptionId, tenantId: ctx.tenantId });
  if (!subscription) throw new NotFoundError("Subscription");
  if (["CANCELLED", "COMPLETED"].includes(subscription.status)) {
    throw new ConflictError("Terminal subscriptions cannot be updated");
  }
  Object.assign(subscription, {
    ...(input.billing_day_anchor !== undefined ? { billingDayAnchor: input.billing_day_anchor } : {}),
    ...(input.net_terms !== undefined ? { netTerms: input.net_terms } : {}),
    ...(input.auto_advance_invoices !== undefined ? { autoAdvanceInvoices: input.auto_advance_invoices } : {}),
    ...(input.charge_automatically !== undefined ? { chargeAutomatically: input.charge_automatically } : {}),
    ...(input.purchase_order !== undefined ? { purchaseOrder: input.purchase_order } : {}),
    ...(input.invoice_memo !== undefined ? { invoiceMemo: input.invoice_memo } : {}),
    updatedAt: new Date(),
  });
  await subscription.save();
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "subscription",
    entityId: subscriptionId,
    action: "updated",
    actorId: ctx.actorId,
    diff: input,
  });
  return subscription;
}

export async function subscriptionDetails(tenantId: string, subscriptionId: string) {
  const subscription = await Subscription.findOne({ _id: subscriptionId, tenantId });
  if (!subscription) throw new NotFoundError("Subscription");
  const components = await SubscriptionComponent.find({ tenantId, subscriptionId });
  const addOns = await SubscriptionAddOn.find({ tenantId, subscriptionId });
  const coupons = await AppliedCoupon.find({ tenantId, subscriptionId });
  return { subscription, components, addOns, coupons };
}

export async function activateCheckoutSubscription(
  ctx: TenantContext,
  input: { planId: string; customerId: string; trialDays: number; couponCodes: string[] },
) {
  return createSubscription(ctx, {
    plan_id: input.planId,
    customer_id_or_alias: input.customerId,
    activation_condition: "ON_CHECKOUT",
    trial_days: input.trialDays,
    billing_day_anchor: 1,
    net_terms: 30,
    coupon_codes: input.couponCodes,
    add_ons: [],
    auto_advance_invoices: true,
    charge_automatically: false,
    start_date: new Date().toISOString(),
  });
}

export async function availablePlanVersions(tenantId: string, planId: string) {
  const plan = await Plan.findOne({ _id: planId, tenantId });
  if (!plan) throw new NotFoundError("Plan");
  return PlanVersion.find({ tenantId, planId }).sort({ version: -1 });
}

export async function customerForSubscription(tenantId: string, customerId: string) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) throw new NotFoundError("Customer");
  return customer;
}
