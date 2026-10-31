import mongoose from "mongoose";
import {
  AppliedCoupon,
  BillableMetric,
  Coupon,
  Customer,
  Entitlement,
  Feature,
  Invoice,
  InvoicingEntity,
  Organization,
  OrganizationMember,
  Plan,
  PlanVersion,
  PriceComponent,
  Product,
  ProductFamily,
  Subscription,
  SubscriptionEvent,
  Tenant,
  User,
} from "@brightloop/db";
import { loadConfig } from "../config/env.js";
import { startDatabase } from "../lib/database.js";
import { hashPassword } from "../services/auth-service.js";
import { createOrganization } from "../services/organization-service.js";
import { createPlan, publishPlan } from "../services/plan-service.js";
import { createSubscription } from "../services/subscription-service.js";
import { ingestEvents } from "../services/metering-service.js";
import { generateInvoices } from "../services/invoice-service.js";

const config = loadConfig();
const database = await startDatabase(config);

try {
  let user = await User.findOne({ email: "demo@brightloop.local" });
  if (!user) {
    user = await User.create({
      email: "demo@brightloop.local",
      passwordHash: await hashPassword("Demo1234"),
      name: "BrightLoop Demo",
      emailVerifiedAt: new Date(),
    });
  } else {
    user.passwordHash = await hashPassword("Demo1234");
    user.emailVerifiedAt = new Date();
    await user.save();
  }

  let org = await Organization.findOne({ slug: "brightloop-demo" });
  let tenant;
  if (!org) {
    const created = await createOrganization(String(user._id), {
      name: "BrightLoop Demo",
      slug: "brightloop-demo",
      tenant_name: "BrightLoop Demo",
      currency: "USD",
    });
    org = created.org;
    tenant = created.tenant;
  } else {
    tenant = await Tenant.findOne({ orgId: String(org._id) }).sort({ createdAt: 1 });
  }
  if (!tenant) throw new Error("seed tenant not found");

  const ctx = {
    tenantId: String(tenant._id),
    orgId: String(org._id),
    userId: String(user._id),
    role: "owner" as const,
    actorId: String(user._id),
  };

  const entity =
    (await InvoicingEntity.findOne({ tenantId: ctx.tenantId, isDefault: true })) ??
    (await InvoicingEntity.create({
      tenantId: ctx.tenantId,
      name: "BrightLoop Demo Inc.",
      legalName: "BrightLoop Demo Inc.",
      address: {
        line1: "100 Market Street",
        city: "San Francisco",
        state: "CA",
        postal_code: "94105",
        country: "US",
      },
      taxId: "US-DEMO-001",
      defaultCurrency: "USD",
      netTerms: 30,
      isDefault: true,
    }));

  let family = await ProductFamily.findOne({ tenantId: ctx.tenantId, alias: "platform" });
  if (!family) family = await ProductFamily.create({ tenantId: ctx.tenantId, name: "Platform", alias: "platform" });

  async function product(alias: string, name: string, feeType: string) {
    let record = await Product.findOne({ tenantId: ctx.tenantId, alias });
    if (!record) {
      record = await Product.create({
        tenantId: ctx.tenantId,
        familyId: String(family!._id),
        name,
        alias,
        feeType,
        description: `${name} product`,
      });
    }
    return record;
  }

  const platform = await product("platform-access", "Platform access", "RATE");
  const overage = await product("api-overage", "API overage", "USAGE");

  async function feature(code: string, name: string, type: "BOOLEAN" | "METERED") {
    let record = await Feature.findOne({ tenantId: ctx.tenantId, code });
    if (!record) record = await Feature.create({ tenantId: ctx.tenantId, name, code, featureType: type });
    return record;
  }

  const apiFeature = await feature("api_calls", "API calls", "BOOLEAN");
  const requestFeature = await feature("api_requests", "API requests", "METERED");

  let metric = await BillableMetric.findOne({ tenantId: ctx.tenantId, code: "api_requests" });
  if (!metric) {
    metric = await BillableMetric.create({
      tenantId: ctx.tenantId,
      name: "API requests",
      code: "api_requests",
      aggregation: "COUNT",
      field: null,
      segmentationKeys: ["endpoint"],
    });
  }

  async function plan(input: {
    alias: string;
    name: string;
    base: string;
    usage: string;
    rank: number;
    trialDays: number;
  }) {
    let planRecord = await Plan.findOne({ tenantId: ctx.tenantId, alias: input.alias });
    if (!planRecord) {
      planRecord = await createPlan(ctx, {
        name: input.name,
        alias: input.alias,
        description: `${input.name} monthly subscription`,
        plan_type: "STANDARD",
        product_family_id: String(family!._id),
        currency: "USD",
        billing_period: "MONTHLY",
        billing_type: "ADVANCE",
        net_terms: 30,
        trial_days: input.trialDays,
        self_service_rank: input.rank,
        components: [
          {
            product_id: String(platform._id),
            metric_id: null,
            name: "Platform access",
            fee_type: "RATE",
            billing_period: "MONTHLY",
            billing_type: "ADVANCE",
            pricing: { type: "FLAT", rate: input.base },
            order: 0,
          },
          {
            product_id: String(overage._id),
            metric_id: String(metric._id),
            name: "API request overage",
            fee_type: "USAGE",
            billing_period: "MONTHLY",
            billing_type: "ARREARS",
            pricing: { type: "PER_UNIT", rate: input.usage },
            order: 1,
          },
        ],
        entitlements: [
          { feature_id: String(apiFeature._id), value: { type: "BOOLEAN", enabled: true } },
          {
            feature_id: String(requestFeature._id),
            value: {
              type: "METERED",
              limit: input.alias === "starter" ? 10000 : 100000,
              reset_period: { type: "BILLING_CYCLE" },
            },
          },
        ],
      });
      await publishPlan(ctx, String(planRecord._id), {});
      planRecord = (await Plan.findById(planRecord._id))!;
    }
    return planRecord;
  }

  const starter = await plan({
    alias: "starter",
    name: "Starter",
    base: "49.00",
    usage: "0.01",
    rank: 1,
    trialDays: 14,
  });
  const growth = await plan({
    alias: "growth",
    name: "Growth",
    base: "199.00",
    usage: "0.008",
    rank: 2,
    trialDays: 14,
  });

  let customer = await Customer.findOne({ tenantId: ctx.tenantId, alias: "acme" });
  if (!customer) {
    customer = await Customer.create({
      tenantId: ctx.tenantId,
      alias: "acme",
      name: "Acme Corporation",
      invoicingEmails: ["billing@acme.example"],
      billingEmail: "billing@acme.example",
      phone: "+1 555 0100",
      vatNumber: "US-ACME-001",
      currency: "USD",
      invoicingEntityId: String(entity._id),
      billingAddress: {
        line1: "1 Acme Way",
        city: "Austin",
        state: "TX",
        postal_code: "78701",
        country: "US",
      },
      customTaxes: [{ name: "Sales tax", rate: "8.25" }],
      isTaxExempt: false,
    });
  }

  let coupon = await Coupon.findOne({ tenantId: ctx.tenantId, code: "LAUNCH20" });
  if (!coupon) {
    coupon = await Coupon.create({
      tenantId: ctx.tenantId,
      code: "LAUNCH20",
      description: "20% off the first invoice",
      discount: { type: "PERCENTAGE", percentage: "20" },
      reusable: true,
      redemptionLimit: null,
      planIds: [],
    });
  }

  let subscription = await Subscription.findOne({
    tenantId: ctx.tenantId,
    customerId: String(customer._id),
    status: { $in: ["ACTIVE", "TRIAL_ACTIVE"] },
  });
  if (!subscription) {
    subscription = await createSubscription(ctx, {
      plan_id: String(starter!._id),
      customer_id_or_alias: "acme",
      activation_condition: "ON_START",
      trial_days: 0,
      billing_day_anchor: 1,
      net_terms: 30,
      coupon_codes: [],
      add_ons: [],
      auto_advance_invoices: true,
      charge_automatically: false,
      start_date: new Date().toISOString(),
      purchase_order: "PO-DEMO-1001",
      invoice_memo: "Thank you for using BrightLoop.",
    });
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const eventCount = 1250;
  const events = [];
  for (let index = 0; index < eventCount; index += 1) {
    events.push({
      event_id: `seed-${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${index}`,
      code: "api_requests",
      customer_id: "acme",
      timestamp: new Date(monthStart.getTime() + index * 30_000).toISOString(),
      properties: { endpoint: index % 3 === 0 ? "/v1/search" : index % 3 === 1 ? "/v1/usage" : "/v1/events" },
    });
  }
  for (let offset = 0; offset < events.length; offset += 100) {
    await ingestEvents(ctx, {
      events: events.slice(offset, offset + 100),
      allow_backfilling: true,
      allow_partial_failures: true,
    });
  }

  const existingInvoice = await Invoice.findOne({
    tenantId: ctx.tenantId,
    subscriptionId: String(subscription._id),
  });
  if (!existingInvoice) {
    await generateInvoices(ctx, {
      subscriptionId: String(subscription._id),
      periodStart: monthStart.toISOString(),
      periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      finalize: true,
    });
  }

  await OrganizationMember.updateOne({ orgId: ctx.orgId, userId: ctx.userId }, { $setOnInsert: { role: "owner" } }, { upsert: true });
  await AppliedCoupon.deleteMany({ tenantId: ctx.tenantId, subscriptionId: String(subscription._id) });

  console.log("BrightLoop seed complete");
  console.log("Login: demo@brightloop.local / Demo1234");
  console.log(`Tenant: ${ctx.tenantId}`);
  console.log(`Plans: starter=${String(starter!._id)} growth=${String(growth!._id)}`);
  console.log(`Customer: ${String(customer._id)} (alias: acme)`);
  console.log(`Subscription: ${String(subscription._id)}`);
} finally {
  await database.stop();
  await mongoose.disconnect().catch(() => undefined);
}
