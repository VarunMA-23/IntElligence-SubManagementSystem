import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  sha256,
  type TenantContext,
} from "@brightloop/shared";
import {
  CheckoutSession,
  Customer,
  Plan,
  PlanVersion,
  PortalToken,
  Subscription,
  SubscriptionEvent,
} from "@brightloop/db";
import type { AppConfig } from "../config/env.js";
import { emitEvent, resolveActivePlanVersion } from "../lib/domain.js";
import { issuePortalToken } from "./auth-service.js";
import { createSubscription } from "./subscription-service.js";

export async function createPortalLink(config: AppConfig, ctx: TenantContext, customerId: string) {
  const customer = await Customer.findOne({ _id: customerId, tenantId: ctx.tenantId });
  if (!customer) throw new NotFoundError("Customer");
  if (customer.archivedAt) throw new ConflictError("Archived customers cannot access the portal");
  const token = issuePortalToken(config, { tenantId: ctx.tenantId, customerId });
  await PortalToken.create({
    tenantId: ctx.tenantId,
    customerId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + config.PORTAL_TOKEN_TTL_MINUTES * 60_000),
  });
  return {
    token,
    url: `${config.WEB_ORIGIN}/portal?token=${encodeURIComponent(token)}`,
    expires_in: config.PORTAL_TOKEN_TTL_MINUTES * 60,
  };
}

export async function createCheckoutSession(ctx: TenantContext, input: any) {
  const customer = await Customer.findOne({ _id: input.customer_id, tenantId: ctx.tenantId });
  if (!customer) throw new NotFoundError("Customer");
  if (customer.archivedAt) throw new ConflictError("Archived customers cannot check out");

  let plan: any;
  let version: any;
  if (input.plan_version_id) {
    version = await PlanVersion.findOne({ _id: input.plan_version_id, tenantId: ctx.tenantId });
    if (!version) throw new NotFoundError("Plan version");
    plan = await Plan.findOne({ _id: version.planId, tenantId: ctx.tenantId });
    if (!plan || plan.archivedAt) throw new ConflictError("Plan is not available");
  } else {
    const resolved = await resolveActivePlanVersion(ctx.tenantId, input.plan_id);
    plan = resolved.plan;
    version = resolved.version;
  }
  const session = await CheckoutSession.create({
    tenantId: ctx.tenantId,
    customerId: input.customer_id,
    planVersionId: String(version._id),
    status: "PENDING",
    successUrl: input.success_url ?? null,
    cancelUrl: input.cancel_url ?? null,
    trialDays: input.trial_days ?? version.trialDays ?? 0,
    couponCodes: input.coupon_codes ?? [],
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  return { session, plan, version };
}

export async function completeCheckoutSession(
  ctx: TenantContext,
  sessionId: string,
  simulateFailure: boolean,
) {
  const session = await CheckoutSession.findOne({ _id: sessionId, tenantId: ctx.tenantId });
  if (!session) throw new NotFoundError("Checkout session");
  if (session.status === "COMPLETED") return session;
  if (session.status !== "PENDING") throw new ConflictError(`Checkout session is ${session.status.toLowerCase()}`);
  if (session.expiresAt.getTime() <= Date.now()) {
    session.status = "EXPIRED";
    await session.save();
    throw new ConflictError("Checkout session has expired");
  }
  if (simulateFailure) {
    session.status = "FAILED";
    session.result = { success: false, error: "simulated payment failure" };
    await session.save();
    return session;
  }

  const plan = await Plan.findOne({
    tenantId: ctx.tenantId,
    _id: (
      await PlanVersion.findOne({ _id: session.planVersionId, tenantId: ctx.tenantId })
    )?.planId,
  });
  if (!plan) throw new NotFoundError("Plan");

  let subscription = session.subscriptionId
    ? await Subscription.findOne({ _id: session.subscriptionId, tenantId: ctx.tenantId })
    : null;
  if (!subscription) {
    subscription = await createSubscription(ctx, {
      plan_id: String(plan._id),
      customer_id_or_alias: session.customerId,
      start_date: new Date().toISOString(),
      activation_condition: "ON_CHECKOUT",
      trial_days: session.trialDays,
      billing_day_anchor: 1,
      net_terms: plan.netTerms ?? 30,
      coupon_codes: session.couponCodes,
      add_ons: [],
      auto_advance_invoices: true,
      charge_automatically: false,
      purchase_order: null,
      invoice_memo: null,
    });
    if (subscription.status === "PENDING_ACTIVATION") {
      subscription.status = session.trialDays > 0 ? "TRIAL_ACTIVE" : "ACTIVE";
      await subscription.save();
      await SubscriptionEvent.create({
        tenantId: ctx.tenantId,
        subscriptionId: String(subscription._id),
        type: "subscription.activated",
        payload: { source: "checkout" },
      });
    }
  }

  session.subscriptionId = String(subscription._id);
  session.status = "COMPLETED";
  session.result = { success: true, subscription_id: String(subscription._id) };
  await session.save();
  await emitEvent(ctx, "checkout.completed", {
    checkoutSessionId: String(session._id),
    customerId: session.customerId,
    subscriptionId: String(subscription._id),
  });
  return session;
}

export async function cancelCheckoutSession(ctx: TenantContext, sessionId: string) {
  const session = await CheckoutSession.findOne({ _id: sessionId, tenantId: ctx.tenantId });
  if (!session) throw new NotFoundError("Checkout session");
  if (session.status === "COMPLETED") throw new ConflictError("Completed checkout sessions cannot be canceled");
  session.status = "CANCELED";
  await session.save();
  return session;
}

export async function portalCheckout(
  ctx: TenantContext,
  customerId: string,
  input: { plan_version_id?: string; plan_id?: string; coupon_codes?: string[] },
) {
  return createCheckoutSession(ctx, {
    customer_id: customerId,
    plan_version_id: input.plan_version_id,
    plan_id: input.plan_id,
    coupon_codes: input.coupon_codes ?? [],
    success_url: null,
    cancel_url: null,
    trial_days: undefined,
  });
}

export async function portalCustomer(tenantId: string, customerId: string) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) throw new NotFoundError("Customer");
  return customer;
}

void BadRequestError;
