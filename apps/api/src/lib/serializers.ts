import Decimal from "decimal.js";
import type { Types } from "mongoose";
import { dec, fromMinorUnits, money } from "@brightloop/shared";

export function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function dateOnly(value: unknown): string | null {
  const valueIso = iso(value);
  return valueIso ? valueIso.slice(0, 10) : null;
}

export function decimalString(value: unknown): string {
  if (value === null || value === undefined) return "0";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value instanceof Decimal) return value.toString();
  const maybe = value as { toString(): string };
  return maybe.toString();
}

export function decimalToNumber(value: unknown): number {
  return Number(decimalString(value));
}

export function minor(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return dec(decimalString(value)).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function minorString(value: unknown): string {
  return String(minor(value));
}

export function roundMoney(value: unknown): string {
  return money(decimalString(value));
}

export function plain<T = Record<string, any>>(doc: any): T {
  if (!doc) return doc;
  if (typeof doc.toObject === "function") return doc.toObject({ getters: false, virtuals: false }) as T;
  return doc as T;
}

export function docId(doc: any): string {
  return String(doc._id);
}

export function objectIdLike(value: Types.ObjectId | string): string {
  return String(value);
}

export function serializeUser(user: any) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    email_verified: Boolean(user.emailVerifiedAt),
    created_at: iso(user.createdAt),
  };
}

export function serializeCustomer(customer: any) {
  return {
    id: String(customer._id),
    alias: customer.alias,
    name: customer.name,
    invoicing_emails: customer.invoicingEmails ?? [],
    billing_email: customer.billingEmail ?? null,
    phone: customer.phone ?? null,
    vat_number: customer.vatNumber ?? null,
    currency: customer.currency,
    invoicing_entity_id: customer.invoicingEntityId,
    billing_address: customer.billingAddress ?? null,
    shipping_address: customer.shippingAddress ?? null,
    custom_taxes: (customer.customTaxes ?? []).map((tax: any) => ({ name: tax.name, rate: decimalString(tax.rate) })),
    is_tax_exempt: Boolean(customer.isTaxExempt),
    exemption_reason: customer.exemptionReason ?? null,
    archived: Boolean(customer.archivedAt),
    archived_at: iso(customer.archivedAt),
    created_at: iso(customer.createdAt),
    updated_at: iso(customer.updatedAt),
  };
}

export function serializeFamily(family: any) {
  return {
    id: String(family._id),
    name: family.name,
    alias: family.alias,
    archived: Boolean(family.archivedAt),
    created_at: iso(family.createdAt),
  };
}

export function serializeProduct(product: any) {
  return {
    id: String(product._id),
    family_id: product.familyId,
    name: product.name,
    alias: product.alias,
    description: product.description ?? null,
    fee_type: product.feeType,
    archived: Boolean(product.archivedAt),
    created_at: iso(product.createdAt),
  };
}

export function serializeFeature(feature: any) {
  return {
    id: String(feature._id),
    name: feature.name,
    code: feature.code,
    feature_type: feature.featureType,
    archived: Boolean(feature.archivedAt),
    created_at: iso(feature.createdAt),
  };
}

export function serializeMetric(metric: any) {
  return {
    id: String(metric._id),
    name: metric.name,
    code: metric.code,
    aggregation: metric.aggregation,
    field: metric.field ?? null,
    segmentation_keys: metric.segmentationKeys ?? [],
    archived: Boolean(metric.archivedAt),
    created_at: iso(metric.createdAt),
  };
}

export function serializeComponent(component: any) {
  return {
    id: String(component._id),
    plan_version_id: component.planVersionId,
    product_id: component.productId ?? null,
    metric_id: component.metricId ?? null,
    name: component.name,
    fee_type: component.feeType,
    billing_period: component.billingPeriod,
    billing_type: component.billingType,
    pricing: component.pricing,
    order: component.order ?? 0,
  };
}

export function serializePlanVersion(version: any, components: any[] = []) {
  return {
    id: String(version._id),
    plan_id: version.planId,
    version: version.version,
    currency: version.currency,
    billing_period: version.billingPeriod,
    billing_type: version.billingType,
    net_terms: version.netTerms,
    trial_days: version.trialDays ?? 0,
    published_at: iso(version.publishedAt),
    created_at: iso(version.createdAt),
    ...(components.length ? { components: components.map(serializeComponent) } : {}),
  };
}

export function serializePlan(plan: any, currentVersion?: any, components: any[] = []) {
  return {
    id: String(plan._id),
    name: plan.name,
    alias: plan.alias,
    description: plan.description ?? null,
    plan_type: plan.planType,
    status: plan.status,
    product_family_id: plan.productFamilyId,
    current_version_id: plan.currentVersionId ?? null,
    currency: plan.currency,
    billing_period: plan.billingPeriod,
    billing_type: plan.billingType,
    net_terms: plan.netTerms,
    trial_days: plan.trialDays ?? 0,
    self_service_rank: plan.selfServiceRank ?? null,
    components: (plan.draftComponents ?? []).map((component: any) => ({
      product_id: component.product_id ?? null,
      metric_id: component.metric_id ?? null,
      name: component.name,
      fee_type: component.fee_type,
      billing_period: component.billing_period,
      billing_type: component.billing_type,
      pricing: component.pricing,
      order: component.order ?? 0,
    })),
    entitlements: (plan.draftEntitlements ?? []).map((entitlement: any) => ({
      feature_id: entitlement.feature_id,
      value: entitlement.value,
    })),
    archived: Boolean(plan.archivedAt),
    archived_at: iso(plan.archivedAt),
    created_at: iso(plan.createdAt),
    ...(currentVersion
      ? { current_version: serializePlanVersion(currentVersion, components) }
      : {}),
  };
}

export function serializeSubscription(subscription: any, extra: Record<string, unknown> = {}) {
  return {
    id: String(subscription._id),
    customer_id: subscription.customerId,
    plan_id: subscription.planId,
    plan_version_id: subscription.planVersionId,
    status: subscription.status,
    start_date: dateOnly(subscription.startDate),
    end_date: dateOnly(subscription.endDate),
    billing_start_date: dateOnly(subscription.billingStartDate),
    current_period_start: dateOnly(subscription.currentPeriodStart),
    current_period_end: dateOnly(subscription.currentPeriodEnd),
    billing_day_anchor: subscription.billingDayAnchor,
    currency: subscription.currency,
    net_terms: subscription.netTerms,
    trial_ends_at: iso(subscription.trialEndsAt),
    canceled_at: iso(subscription.canceledAt),
    cancellation_reason: subscription.cancellationReason ?? null,
    auto_advance_invoices: Boolean(subscription.autoAdvanceInvoices),
    charge_automatically: Boolean(subscription.chargeAutomatically),
    purchase_order: subscription.purchaseOrder ?? null,
    invoice_memo: subscription.invoiceMemo ?? null,
    created_at: iso(subscription.createdAt),
    ...extra,
  };
}

export function serializeCoupon(coupon: any) {
  return {
    id: String(coupon._id),
    code: coupon.code,
    description: coupon.description ?? null,
    discount: coupon.discount,
    reusable: Boolean(coupon.reusable),
    disabled: Boolean(coupon.disabled),
    redemption_limit: coupon.redemptionLimit ?? null,
    redemption_count: coupon.redemptionCount ?? 0,
    recurring_value: coupon.recurringValue ?? null,
    expires_at: iso(coupon.expiresAt),
    plan_ids: coupon.planIds ?? [],
    archived: Boolean(coupon.archivedAt),
    created_at: iso(coupon.createdAt),
  };
}

export function serializeAddOn(addOn: any) {
  return {
    id: String(addOn._id),
    name: addOn.name,
    alias: addOn.alias,
    product_id: addOn.productId,
    description: addOn.description ?? null,
    fee_type: addOn.feeType ?? null,
    self_serviceable: Boolean(addOn.selfServiceable),
    max_instances_per_subscription: addOn.maxInstancesPerSubscription ?? null,
    pricing: addOn.pricing,
    archived: Boolean(addOn.archivedAt),
    created_at: iso(addOn.createdAt),
  };
}

export function serializeInvoice(invoice: any, lineItems: any[] = []) {
  return {
    id: String(invoice._id),
    invoice_number: invoice.number,
    status: invoice.status,
    customer_id: invoice.customerId,
    subscription_id: invoice.subscriptionId ?? null,
    currency: invoice.currency,
    invoice_date: dateOnly(invoice.invoiceDate),
    due_date: dateOnly(invoice.dueDate),
    subtotal: minor(invoice.subtotal),
    subtotal_recurring: minor(invoice.subtotalRecurring),
    tax_amount: minor(invoice.taxAmount),
    total: minor(invoice.total),
    amount_due: minor(invoice.amountDue),
    applied_credits: minor(invoice.appliedCredits),
    line_items: lineItems.map((line) => ({
      id: String(line._id),
      product_id: line.productId ?? null,
      metric_code: line.metricCode ?? null,
      name: line.name,
      description: line.description ?? null,
      quantity: decimalString(line.quantity),
      unit_price: decimalString(line.unitPrice),
      amount: minor(line.amountTotal),
      tax_rate: decimalString(line.taxRate),
      tax_amount: minor(line.taxAmount),
      period_start: dateOnly(line.periodStart),
      period_end: dateOnly(line.periodEnd),
      order: line.order ?? 0,
    })),
    tax_breakdown: invoice.taxBreakdown ?? [],
    transactions: [],
    payment_status: invoice.paidAt ? "PAID" : invoice.amountDue && minor(invoice.amountDue) === 0 ? "PAID" : "PENDING",
    customer_details: invoice.customerDetails ?? {},
    coupons: invoice.coupons ?? [],
    invoice_type: invoice.invoiceType,
    net_terms: invoice.netTerms,
    memo: invoice.memo ?? null,
    purchase_order: invoice.purchaseOrder ?? null,
    period_start: dateOnly(invoice.periodStart),
    period_end: dateOnly(invoice.periodEnd),
    finalized_at: iso(invoice.finalizedAt),
    voided_at: iso(invoice.voidedAt),
    created_at: iso(invoice.createdAt),
  };
}

export function serializeCreditNote(note: any) {
  return {
    id: String(note._id),
    invoice_id: note.invoiceId,
    customer_id: note.customerId,
    credit_note_number: note.number,
    status: note.status,
    currency: note.currency,
    total: minor(note.total),
    reason: note.reason,
    issued_at: iso(note.issuedAt),
    created_at: iso(note.createdAt),
  };
}

export function serializeEntitlement(entitlement: any) {
  return {
    feature_id: entitlement.featureId,
    feature_code: entitlement.featureCode,
    feature_name: entitlement.featureName,
    value: entitlement.value,
    source: entitlement.source,
    ...(entitlement.usage ? { usage: entitlement.usage } : {}),
  };
}

export function serializeWebhook(webhook: any) {
  return {
    id: String(webhook._id),
    url: webhook.url,
    events: webhook.events ?? [],
    enabled: Boolean(webhook.enabled),
    created_at: iso(webhook.createdAt),
  };
}

export function serializeDelivery(delivery: any) {
  return {
    id: String(delivery._id),
    webhook_id: delivery.webhookId,
    event_type: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts ?? 0,
    response_status: delivery.responseStatus ?? null,
    last_error: delivery.lastError ?? null,
    next_attempt_at: iso(delivery.nextAttemptAt),
    created_at: iso(delivery.createdAt),
  };
}

export function serializeBatchJob(job: any) {
  return {
    id: String(job._id),
    type: job.type,
    status: job.status,
    total: job.total ?? 0,
    processed: job.processed ?? 0,
    failed: job.failed ?? 0,
    created_by: job.createdBy ?? null,
    created_at: iso(job.createdAt),
  };
}

export function serializeCheckout(session: any) {
  return {
    id: String(session._id),
    customer_id: session.customerId,
    plan_version_id: session.planVersionId,
    subscription_id: session.subscriptionId ?? null,
    status: session.status,
    success_url: session.successUrl ?? null,
    cancel_url: session.cancelUrl ?? null,
    result: session.result ?? null,
    expires_at: iso(session.expiresAt),
    created_at: iso(session.createdAt),
  };
}

export function serializePortalCustomer(customer: any) {
  return {
    id: String(customer._id),
    alias: customer.alias,
    name: customer.name,
    currency: customer.currency,
    billing_email: customer.billingEmail ?? null,
    invoicing_emails: customer.invoicingEmails ?? [],
  };
}

export function serializeActivity(activity: any) {
  return {
    id: String(activity._id),
    entity_type: activity.entityType,
    entity_id: activity.entityId,
    action: activity.action,
    actor_id: activity.actorId ?? null,
    diff: activity.diff ?? null,
    created_at: iso(activity.createdAt),
  };
}

export function moneyFromMinor(value: number, currency = "USD"): string {
  return fromMinorUnits(value, currency);
}
