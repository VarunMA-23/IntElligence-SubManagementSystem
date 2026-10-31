import mongoose, { Schema, type Model } from "mongoose";
import { newId, newOpaqueToken, sha256 } from "@brightloop/shared";

const { Types } = Schema;
const Decimal = Types.Decimal128;

function model<T = any>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T>) ?? mongoose.model<T>(name, schema);
}

const baseOptions = { versionKey: false, minimize: false } as const;

const idField = { type: String, default: () => newId() } as const;

function _tenantIndexes(schema: Schema, collection: string) {
  schema.index({ tenantId: 1, createdAt: -1 });
  void collection;
  return schema;
}

const userSchema = new Schema(
  {
    _id: idField,
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    emailVerifiedAt: { type: Date, default: null },
    verificationTokenHash: { type: String, default: null },
    resetTokenHash: { type: String, default: null },
    resetExpiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

const organizationSchema = new Schema(
  {
    _id: idField,
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

const organizationMemberSchema = new Schema(
  {
    _id: idField,
    orgId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ["owner", "admin", "member", "viewer"], required: true },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
organizationMemberSchema.index({ orgId: 1, userId: 1 }, { unique: true });

const organizationInviteSchema = new Schema(
  {
    _id: idField,
    orgId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true },
    role: { type: String, enum: ["admin", "member", "viewer"], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

const tenantSchema = new Schema(
  {
    _id: idField,
    orgId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    currency: { type: String, required: true, default: "USD" },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
tenantSchema.index({ orgId: 1, slug: 1 }, { unique: true });

const apiTokenSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    prefix: { type: String, required: true },
    role: { type: String, enum: ["admin", "member", "viewer"], required: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

const refreshTokenSchema = new Schema(
  {
    _id: idField,
    userId: { type: String, required: true, index: true },
    orgId: { type: String, default: null },
    tenantId: { type: String, default: null },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    rotatedFrom: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

const portalTokenSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
  },
  baseOptions,
);

const invoicingEntitySchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    name: { type: String, required: true },
    legalName: { type: String, default: null },
    address: { type: Schema.Types.Mixed, default: null },
    taxId: { type: String, default: null },
    defaultCurrency: { type: String, required: true },
    netTerms: { type: Number, default: 30 },
    isDefault: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
invoicingEntitySchema.index({ tenantId: 1, isDefault: 1 });

const customerSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    alias: { type: String, required: true },
    name: { type: String, required: true },
    invoicingEmails: { type: [String], default: [] },
    billingEmail: { type: String, default: null },
    phone: { type: String, default: null },
    vatNumber: { type: String, default: null },
    billingAddress: { type: Schema.Types.Mixed, default: null },
    shippingAddress: { type: Schema.Types.Mixed, default: null },
    currency: { type: String, required: true },
    invoicingEntityId: { type: String, required: true },
    customTaxes: { type: [Schema.Types.Mixed], default: [] },
    isTaxExempt: { type: Boolean, default: false },
    exemptionReason: { type: String, default: null },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
customerSchema.index({ tenantId: 1, alias: 1 }, { unique: true });
customerSchema.index({ tenantId: 1, archivedAt: 1, createdAt: -1 });
customerSchema.index({ tenantId: 1, invoicingEmails: 1 });

const productFamilySchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    name: { type: String, required: true },
    alias: { type: String, required: true },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
productFamilySchema.index({ tenantId: 1, alias: 1 }, { unique: true });

const productSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    familyId: { type: String, required: true },
    name: { type: String, required: true },
    alias: { type: String, required: true },
    description: { type: String, default: null },
    feeType: { type: String, required: true },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
productSchema.index({ tenantId: 1, alias: 1 }, { unique: true });
productSchema.index({ tenantId: 1, familyId: 1 });
productSchema.index({ tenantId: 1, archivedAt: 1 });

const featureSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    featureType: { type: String, enum: ["BOOLEAN", "METERED"], required: true },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
featureSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const billableMetricSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    aggregation: { type: String, required: true },
    field: { type: String, default: null },
    segmentationKeys: { type: [String], default: [] },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
billableMetricSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const taxCategorySchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    name: { type: String, required: true },
    rate: { type: Decimal, required: true },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

const planSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    name: { type: String, required: true },
    alias: { type: String, required: true },
    description: { type: String, default: null },
    planType: { type: String, default: "STANDARD" },
    status: { type: String, default: "DRAFT" },
    productFamilyId: { type: String, required: true },
    currentVersionId: { type: String, default: null },
    currency: { type: String, required: true },
    billingPeriod: { type: String, required: true },
    billingType: { type: String, required: true },
    netTerms: { type: Number, default: 30 },
    trialDays: { type: Number, default: 0 },
    selfServiceRank: { type: Number, default: null },
    draftComponents: { type: [Schema.Types.Mixed], default: [] },
    draftEntitlements: { type: [Schema.Types.Mixed], default: [] },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
planSchema.index({ tenantId: 1, alias: 1 }, { unique: true });
planSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

const planVersionSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    planId: { type: String, required: true },
    version: { type: Number, required: true },
    currency: { type: String, required: true },
    billingPeriod: { type: String, required: true },
    billingType: { type: String, required: true },
    netTerms: { type: Number, required: true },
    trialDays: { type: Number, default: 0 },
    publishedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
planVersionSchema.index({ tenantId: 1, planId: 1, version: 1 }, { unique: true });

const priceComponentSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    planVersionId: { type: String, required: true },
    productId: { type: String, default: null },
    metricId: { type: String, default: null },
    name: { type: String, required: true },
    feeType: { type: String, required: true },
    billingPeriod: { type: String, required: true },
    billingType: { type: String, required: true },
    pricing: { type: Schema.Types.Mixed, required: true },
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
priceComponentSchema.index({ tenantId: 1, planVersionId: 1, order: 1 });

const addOnSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    name: { type: String, required: true },
    alias: { type: String, required: true },
    productId: { type: String, required: true },
    description: { type: String, default: null },
    feeType: { type: String, default: null },
    selfServiceable: { type: Boolean, default: true },
    maxInstancesPerSubscription: { type: Number, default: null },
    pricing: { type: Schema.Types.Mixed, required: true },
    entitlements: { type: [Schema.Types.Mixed], default: [] },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
addOnSchema.index({ tenantId: 1, alias: 1 }, { unique: true });

const planAddOnSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    planVersionId: { type: String, required: true },
    addOnId: { type: String, required: true },
    priceOverride: { type: Schema.Types.Mixed, default: null },
  },
  baseOptions,
);

const subscriptionSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    customerId: { type: String, required: true, index: true },
    planId: { type: String, required: true },
    planVersionId: { type: String, required: true },
    status: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    billingStartDate: { type: Date, default: null },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, default: null },
    billingDayAnchor: { type: Number, default: 1 },
    currency: { type: String, required: true },
    netTerms: { type: Number, default: 30 },
    trialEndsAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null },
    autoAdvanceInvoices: { type: Boolean, default: true },
    chargeAutomatically: { type: Boolean, default: false },
    purchaseOrder: { type: String, default: null },
    invoiceMemo: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
subscriptionSchema.index({ tenantId: 1, customerId: 1, status: 1 });
subscriptionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

const subscriptionComponentSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    subscriptionId: { type: String, required: true },
    priceComponentId: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    overrides: { type: Schema.Types.Mixed, default: null },
  },
  baseOptions,
);
subscriptionComponentSchema.index({ tenantId: 1, subscriptionId: 1 });

const subscriptionAddOnSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    subscriptionId: { type: String, required: true },
    addOnId: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    customization: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
subscriptionAddOnSchema.index({ tenantId: 1, subscriptionId: 1 });

const couponSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    code: { type: String, required: true },
    description: { type: String, default: null },
    discount: { type: Schema.Types.Mixed, required: true },
    reusable: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    redemptionLimit: { type: Number, default: null },
    redemptionCount: { type: Number, default: 0 },
    recurringValue: { type: Number, default: null },
    expiresAt: { type: Date, default: null },
    planIds: { type: [String], default: [] },
    archivedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
couponSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const appliedCouponSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    subscriptionId: { type: String, required: true },
    couponId: { type: String, required: true },
    status: { type: String, default: "active" },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    appliedCount: { type: Number, default: 0 },
    appliedAmount: { type: String, default: null },
  },
  baseOptions,
);
appliedCouponSchema.index({ tenantId: 1, subscriptionId: 1 });

const subscriptionEventSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    subscriptionId: { type: String, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

const eventSchema = new Schema(
  {
    eventId: { type: String, required: true },
    timestamp: { type: Date, required: true },
    value: { type: Decimal, required: true },
    properties: { type: Schema.Types.Mixed, default: {} },
    meta: {
      tenantId: { type: String, required: true },
      customerId: { type: String, required: true },
      metricCode: { type: String, required: true },
      subscriptionId: { type: String, default: null },
    },
    ingestedAt: { type: Date, default: Date.now },
  },
  {
    ...baseOptions,
    _id: false,
    timeseries: { timeField: "timestamp", metaField: "meta", granularity: "seconds" },
    expireAfterSeconds: 60 * 60 * 24 * 365 * 3,
  } as any,
);
eventSchema.index({ "meta.tenantId": 1, "meta.customerId": 1, "meta.metricCode": 1, timestamp: 1 });

const eventKeySchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    customerId: { type: String, required: true },
    eventId: { type: String, required: true },
    timestamp: { type: Date, required: true },
  },
  baseOptions,
);
eventKeySchema.index({ tenantId: 1, customerId: 1, eventId: 1 }, { unique: true });

const usageSummarySchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    metricCode: { type: String, required: true },
    customerId: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    aggregatedValue: { type: Decimal, required: true },
    groupedBy: { type: Schema.Types.Mixed, default: {} },
  },
  baseOptions,
);
usageSummarySchema.index({ tenantId: 1, metricCode: 1, customerId: 1, periodStart: 1 }, { unique: true });

const invoiceSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    customerId: { type: String, required: true },
    subscriptionId: { type: String, default: null },
    number: { type: String, required: true },
    status: { type: String, required: true, default: "DRAFT" },
    invoiceType: { type: String, required: true, default: "RECURRING" },
    currency: { type: String, required: true },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date, default: null },
    netTerms: { type: Number, default: 30 },
    subtotal: { type: Decimal, required: true },
    subtotalRecurring: { type: Decimal, required: true, default: 0 },
    taxAmount: { type: Decimal, required: true, default: 0 },
    total: { type: Decimal, required: true },
    amountDue: { type: Decimal, required: true },
    appliedCredits: { type: Decimal, default: 0 },
    couponDiscount: { type: Decimal, default: 0 },
    coupons: { type: [Schema.Types.Mixed], default: [] },
    memo: { type: String, default: null },
    purchaseOrder: { type: String, default: null },
    reference: { type: String, default: null },
    customerDetails: { type: Schema.Types.Mixed, default: {} },
    taxBreakdown: { type: [Schema.Types.Mixed], default: [] },
    finalizedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    voidedAt: { type: Date, default: null },
    paymentReference: { type: String, default: null },
    pdfObjectKey: { type: String, default: null },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
invoiceSchema.index({ tenantId: 1, number: 1 }, { unique: true });
invoiceSchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });
invoiceSchema.index({ tenantId: 1, status: 1, dueDate: 1 });

const invoiceLineItemSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    invoiceId: { type: String, required: true },
    productId: { type: String, default: null },
    metricCode: { type: String, default: null },
    name: { type: String, required: true },
    description: { type: String, default: null },
    quantity: { type: Decimal, required: true },
    unitPrice: { type: Decimal, required: true },
    amountTotal: { type: Decimal, required: true },
    taxRate: { type: Decimal, default: 0 },
    taxAmount: { type: Decimal, default: 0 },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    subLineItems: { type: [Schema.Types.Mixed], default: [] },
    order: { type: Number, default: 0 },
  },
  baseOptions,
);
invoiceLineItemSchema.index({ tenantId: 1, invoiceId: 1, order: 1 });

const creditNoteSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    invoiceId: { type: String, required: true },
    customerId: { type: String, required: true },
    number: { type: String, required: true },
    status: { type: String, default: "ISSUED" },
    currency: { type: String, required: true },
    total: { type: Decimal, required: true },
    reason: { type: String, required: true },
    issuedAt: { type: Date, default: null },
    pdfObjectKey: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
creditNoteSchema.index({ tenantId: 1, number: 1 }, { unique: true });

const creditNoteLineItemSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    creditNoteId: { type: String, required: true },
    description: { type: String, required: true },
    quantity: { type: Decimal, required: true },
    unitPrice: { type: Decimal, required: true },
    amount: { type: Decimal, required: true },
  },
  baseOptions,
);

const entitlementSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    featureId: { type: String, required: true },
    scope: { type: String, enum: ["PLAN", "ADD_ON", "PRODUCT"], required: true },
    scopeId: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
entitlementSchema.index({ tenantId: 1, featureId: 1, scope: 1, scopeId: 1 }, { unique: true });

const entitlementUsageSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    customerId: { type: String, required: true },
    featureId: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, default: null },
    used: { type: Decimal, default: 0 },
    limit: { type: Decimal, default: 0 },
  },
  baseOptions,
);
entitlementUsageSchema.index({ tenantId: 1, customerId: 1, featureId: 1, periodStart: 1 }, { unique: true });

const outboxEventSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, default: "PENDING" },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    error: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
outboxEventSchema.index({ status: 1, availableAt: 1 });

const webhookSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    url: { type: String, required: true },
    secretCipher: { type: String, required: true },
    events: { type: [String], default: [] },
    enabled: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

const webhookDeliverySchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    webhookId: { type: String, required: true },
    eventType: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, default: "PENDING" },
    attempts: { type: Number, default: 0 },
    responseStatus: { type: Number, default: null },
    lastError: { type: String, default: null },
    nextAttemptAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
webhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });

const deadLetterEventSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    source: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    error: { type: String, default: null },
    failedAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

const idempotencyKeySchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    key: { type: String, required: true },
    endpoint: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: { type: String, default: "completed" },
    responseStatus: { type: Number, required: true },
    responseBody: { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
idempotencyKeySchema.index({ tenantId: 1, key: 1, endpoint: 1 }, { unique: true });
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const entityActivitySchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    action: { type: String, required: true },
    actorId: { type: String, default: null },
    diff: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
entityActivitySchema.index({ tenantId: 1, entityType: 1, entityId: 1, createdAt: -1 });

const batchJobSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    type: { type: String, required: true },
    status: { type: String, default: "PENDING" },
    total: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    createdBy: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
batchJobSchema.index({ tenantId: 1, createdAt: -1 });

const batchJobItemSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    batchJobId: { type: String, required: true },
    index: { type: Number, required: true },
    input: { type: Schema.Types.Mixed, default: null },
    status: { type: String, default: "PENDING" },
    error: { type: String, default: null },
  },
  baseOptions,
);
batchJobItemSchema.index({ tenantId: 1, batchJobId: 1, index: 1 }, { unique: true });

const checkoutSessionSchema = new Schema(
  {
    _id: idField,
    tenantId: { type: String, required: true },
    customerId: { type: String, required: true },
    planVersionId: { type: String, required: true },
    subscriptionId: { type: String, default: null },
    status: { type: String, default: "PENDING" },
    successUrl: { type: String, default: null },
    cancelUrl: { type: String, default: null },
    trialDays: { type: Number, default: 0 },
    couponCodes: { type: [String], default: [] },
    result: { type: Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  baseOptions,
);
checkoutSessionSchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });
checkoutSessionSchema.index({ status: 1, expiresAt: 1 });

const lockSchema = new Schema(
  {
    _id: { type: String },
    owner: { type: String, required: true },
    lockedUntil: { type: Date, required: true },
  },
  baseOptions,
);
lockSchema.index({ lockedUntil: 1 }, { expireAfterSeconds: 0 });

const counterSchema = new Schema(
  {
    _id: { type: String },
    value: { type: Number, default: 0 },
  },
  baseOptions,
);

const migrationSchema = new Schema(
  {
    _id: { type: String },
    name: { type: String, required: true },
    appliedAt: { type: Date, default: Date.now },
  },
  baseOptions,
);

export const User = model("User", userSchema);
export const Organization = model("Organization", organizationSchema);
export const OrganizationMember = model("OrganizationMember", organizationMemberSchema);
export const OrganizationInvite = model("OrganizationInvite", organizationInviteSchema);
export const Tenant = model("Tenant", tenantSchema);
export const ApiToken = model("ApiToken", apiTokenSchema);
export const RefreshToken = model("RefreshToken", refreshTokenSchema);
export const PortalToken = model("PortalToken", portalTokenSchema);
export const InvoicingEntity = model("InvoicingEntity", invoicingEntitySchema);
export const Customer = model("Customer", customerSchema);
export const ProductFamily = model("ProductFamily", productFamilySchema);
export const Product = model("Product", productSchema);
export const Feature = model("Feature", featureSchema);
export const BillableMetric = model("BillableMetric", billableMetricSchema);
export const TaxCategory = model("TaxCategory", taxCategorySchema);
export const Plan = model("Plan", planSchema);
export const PlanVersion = model("PlanVersion", planVersionSchema);
export const PriceComponent = model("PriceComponent", priceComponentSchema);
export const AddOn = model("AddOn", addOnSchema);
export const PlanAddOn = model("PlanAddOn", planAddOnSchema);
export const Subscription = model("Subscription", subscriptionSchema);
export const SubscriptionComponent = model("SubscriptionComponent", subscriptionComponentSchema);
export const SubscriptionAddOn = model("SubscriptionAddOn", subscriptionAddOnSchema);
export const Coupon = model("Coupon", couponSchema);
export const AppliedCoupon = model("AppliedCoupon", appliedCouponSchema);
export const SubscriptionEvent = model("SubscriptionEvent", subscriptionEventSchema);
export const UsageEvent = model("UsageEvent", eventSchema);
export const EventKey = model("EventKey", eventKeySchema);
export const UsageSummary = model("UsageSummary", usageSummarySchema);
export const Invoice = model("Invoice", invoiceSchema);
export const InvoiceLineItem = model("InvoiceLineItem", invoiceLineItemSchema);
export const CreditNote = model("CreditNote", creditNoteSchema);
export const CreditNoteLineItem = model("CreditNoteLineItem", creditNoteLineItemSchema);
export const Entitlement = model("Entitlement", entitlementSchema);
export const EntitlementUsage = model("EntitlementUsage", entitlementUsageSchema);
export const OutboxEvent = model("OutboxEvent", outboxEventSchema);
export const Webhook = model("Webhook", webhookSchema);
export const WebhookDelivery = model("WebhookDelivery", webhookDeliverySchema);
export const DeadLetterEvent = model("DeadLetterEvent", deadLetterEventSchema);
export const IdempotencyKey = model("IdempotencyKey", idempotencyKeySchema);
export const EntityActivity = model("EntityActivity", entityActivitySchema);
export const BatchJob = model("BatchJob", batchJobSchema);
export const BatchJobItem = model("BatchJobItem", batchJobItemSchema);
export const CheckoutSession = model("CheckoutSession", checkoutSessionSchema);
export const Lock = model("Lock", lockSchema);
export const Counter = model("Counter", counterSchema);
export const Migration = model("Migration", migrationSchema);

export { Types, Decimal, newOpaqueToken, sha256 };
