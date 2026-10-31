import mongoose from "mongoose";
import {
  AppliedCoupon,
  BillableMetric,
  Coupon,
  Customer,
  Feature,
  Invoice,
  InvoicingEntity,
  Organization,
  OrganizationMember,
  Plan,
  Product,
  ProductFamily,
  Subscription,
  Tenant,
  User,
} from "@brightloop/db";
import { loadConfig } from "../config/env.js";
import { startDatabase } from "../lib/database.js";
import { createPlan, publishPlan } from "../services/plan-service.js";
import { createSubscription } from "../services/subscription-service.js";
import { ingestEvents } from "../services/metering-service.js";
import { generateInvoices } from "../services/invoice-service.js";

const config = loadConfig();
const database = await startDatabase(config);

try {
  // Find Ansh's user
  const user = await User.findOne({ email: "anshgupta022007@gmail.com" });
  if (!user) throw new Error("User anshgupta022007@gmail.com not found");

  // Find the org and tenant for this user
  const member = await OrganizationMember.findOne({ userId: String(user._id) });
  if (!member) throw new Error("Org membership not found for user");
  const org = await Organization.findOne({ _id: member.orgId });
  if (!org) throw new Error("Organization not found");
  const tenant = await Tenant.findOne({ orgId: String(org._id) }).sort({ createdAt: 1 });
  if (!tenant) throw new Error("Tenant not found");

  const ctx = {
    tenantId: String(tenant._id),
    orgId: String(org._id),
    userId: String(user._id),
    role: "owner" as const,
    actorId: String(user._id),
  };

  console.log(`Seeding data for tenant: ${ctx.tenantId} (${tenant.name})`);

  // Invoicing entity
  const entity =
    (await InvoicingEntity.findOne({ tenantId: ctx.tenantId, isDefault: true })) ??
    (await InvoicingEntity.create({
      tenantId: ctx.tenantId,
      name: "Acme Billing Inc.",
      legalName: "Acme Billing Inc.",
      address: {
        line1: "200 Innovation Drive",
        city: "Austin",
        state: "TX",
        postal_code: "73301",
        country: "US",
      },
      taxId: "US-ACME-002",
      defaultCurrency: "USD",
      netTerms: 30,
      isDefault: true,
    }));

  // Product family
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
  const storage = await product("storage", "Storage", "USAGE");

  // Features
  async function feature(code: string, name: string, type: "BOOLEAN" | "METERED") {
    let record = await Feature.findOne({ tenantId: ctx.tenantId, code });
    if (!record) record = await Feature.create({ tenantId: ctx.tenantId, name, code, featureType: type });
    return record;
  }

  const apiFeature = await feature("api_calls", "API calls", "BOOLEAN");
  const requestFeature = await feature("api_requests", "API requests", "METERED");
  const storageFeature = await feature("storage_gb", "Storage (GB)", "METERED");

  // Billable metrics
  async function metric(code: string, name: string, aggregation: string, segKeys: string[] = []) {
    let record = await BillableMetric.findOne({ tenantId: ctx.tenantId, code });
    if (!record) {
      record = await BillableMetric.create({
        tenantId: ctx.tenantId,
        name,
        code,
        aggregation,
        field: null,
        segmentationKeys: segKeys,
      });
    }
    return record;
  }

  const requestMetric = await metric("api_requests", "API requests", "COUNT", ["endpoint"]);
  const storageMetric = await metric("storage_gb", "Storage GB-hours", "MAX", ["region"]);

  // Plans
  async function plan(input: {
    alias: string;
    name: string;
    base: string;
    usage: string;
    rank: number;
    trialDays: number;
    storageRate: string;
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
            metric_id: String(requestMetric._id),
            name: "API request overage",
            fee_type: "USAGE",
            billing_period: "MONTHLY",
            billing_type: "ARREARS",
            pricing: { type: "PER_UNIT", rate: input.usage },
            order: 1,
          },
          {
            product_id: String(storage._id),
            metric_id: String(storageMetric._id),
            name: "Storage",
            fee_type: "USAGE",
            billing_period: "MONTHLY",
            billing_type: "ARREARS",
            pricing: { type: "PER_UNIT", rate: input.storageRate },
            order: 2,
          },
        ],
        entitlements: [
          { feature_id: String(apiFeature._id), value: { type: "BOOLEAN", enabled: true } },
          {
            feature_id: String(requestFeature._id),
            value: {
              type: "METERED",
              limit: input.alias === "starter" ? 10000 : input.alias === "growth" ? 100000 : 500000,
              reset_period: { type: "BILLING_CYCLE" },
            },
          },
          {
            feature_id: String(storageFeature._id),
            value: {
              type: "METERED",
              limit: input.alias === "starter" ? 50 : input.alias === "growth" ? 500 : 2000,
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
    storageRate: "0.20",
  });
  const growth = await plan({
    alias: "growth",
    name: "Growth",
    base: "199.00",
    usage: "0.008",
    rank: 2,
    trialDays: 14,
    storageRate: "0.15",
  });
  const scale = await plan({
    alias: "scale",
    name: "Scale",
    base: "499.00",
    usage: "0.005",
    rank: 3,
    trialDays: 0,
    storageRate: "0.10",
  });

  console.log(`Plans created: starter=${String(starter!._id)} growth=${String(growth!._id)} scale=${String(scale!._id)}`);

  // Customers
  const customerDefs = [
    { alias: "globex", name: "Globex Corporation", email: "billing@globex.example", phone: "+1 555 0200", vat: "US-GLOBEX-001", city: "New York", state: "NY", zip: "10001" },
    { alias: "initech", name: "Initech LLC", email: "ap@initech.example", phone: "+1 555 0300", vat: "US-INITECH-001", city: "Houston", state: "TX", zip: "77001" },
    { alias: "umbrella", name: "Umbrella Inc.", email: "finance@umbrella.example", phone: "+1 555 0400", vat: "US-UMB-001", city: "Racoon City", state: "NJ", zip: "07001" },
    { alias: "stark", name: "Stark Industries", email: "billing@stark.example", phone: "+1 555 0500", vat: "US-STARK-001", city: "Malibu", state: "CA", zip: "90265" },
    { alias: "wayne", name: "Wayne Enterprises", email: "accounts@wayne.example", phone: "+1 555 0600", vat: "US-WAYNE-001", city: "Gotham", state: "IL", zip: "60601" },
  ];

  const customers: { id: string; alias: string; name: string }[] = [];

  // Keep existing "atlas" customer
  const existing = await Customer.findOne({ tenantId: ctx.tenantId, alias: "atlas" });
  if (existing) customers.push({ id: String(existing._id), alias: "atlas", name: existing.name });

  for (const def of customerDefs) {
    let customer = await Customer.findOne({ tenantId: ctx.tenantId, alias: def.alias });
    if (!customer) {
      customer = await Customer.create({
        tenantId: ctx.tenantId,
        alias: def.alias,
        name: def.name,
        invoicingEmails: [def.email],
        billingEmail: def.email,
        phone: def.phone,
        vatNumber: def.vat,
        currency: "USD",
        invoicingEntityId: String(entity._id),
        billingAddress: {
          line1: `1 ${def.alias} Plaza`,
          city: def.city,
          state: def.state,
          postal_code: def.zip,
          country: "US",
        },
        customTaxes: [{ name: "Sales tax", rate: "8.25" }],
        isTaxExempt: false,
      });
    }
    customers.push({ id: String(customer._id), alias: def.alias, name: customer.name });
  }

  console.log(`Customers: ${customers.length}`);

  // Coupon
  let coupon = await Coupon.findOne({ tenantId: ctx.tenantId, code: "WELCOME15" });
  if (!coupon) {
    coupon = await Coupon.create({
      tenantId: ctx.tenantId,
      code: "WELCOME15",
      description: "15% off first invoice",
      discount: { type: "PERCENTAGE", percentage: "15" },
      reusable: true,
      redemptionLimit: null,
      planIds: [],
    });
  }

  // Subscriptions - assign different plans to different customers
  const subDefs = [
    { customerAlias: "atlas", planAlias: "starter", po: "PO-ACME-2001", memo: "Thanks for choosing BrightLoop." },
    { customerAlias: "globex", planAlias: "growth", po: "PO-GLOBEX-3001", memo: "Globex monthly billing." },
    { customerAlias: "initech", planAlias: "starter", po: "PO-INITECH-4001", memo: "Initech subscription." },
    { customerAlias: "umbrella", planAlias: "scale", po: "PO-UMB-5001", memo: "Umbrella enterprise plan." },
    { customerAlias: "stark", planAlias: "growth", po: "PO-STARK-6001", memo: "Stark Industries billing." },
    { customerAlias: "wayne", planAlias: "scale", po: "PO-WAYNE-7001", memo: "Wayne Enterprises billing." },
  ];

  const planMap: Record<string, string> = {
    starter: String(starter._id),
    growth: String(growth._id),
    scale: String(scale._id),
  };

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  for (const subDef of subDefs) {
    const existingSub = await Subscription.findOne({
      tenantId: ctx.tenantId,
      customerId: customers.find((c) => c.alias === subDef.customerAlias)!.id,
      status: { $in: ["ACTIVE", "TRIAL_ACTIVE"] },
    });
    if (existingSub) {
      console.log(`  Subscription exists for ${subDef.customerAlias} (${subDef.planAlias})`);
      continue;
    }
    try {
      const sub = await createSubscription(ctx, {
        plan_id: planMap[subDef.planAlias],
        customer_id_or_alias: subDef.customerAlias,
        activation_condition: "ON_START",
        trial_days: 0,
        billing_day_anchor: 1,
        net_terms: 30,
        coupon_codes: [],
        add_ons: [],
        auto_advance_invoices: true,
        charge_automatically: false,
        start_date: new Date().toISOString(),
        purchase_order: subDef.po,
        invoice_memo: subDef.memo,
      });
      console.log(`  Subscription created: ${subDef.customerAlias} -> ${subDef.planAlias} (${String(sub._id)})`);
    } catch (e: any) {
      console.log(`  Subscription failed for ${subDef.customerAlias}: ${e.message}`);
    }
  }

  // Usage events for each subscribed customer
  const eventCount = 500;
  for (const cust of customers) {
    const events: any[] = [];
    for (let i = 0; i < eventCount; i++) {
      events.push({
        event_id: `ansh-seed-${cust.alias}-${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${i}`,
        code: "api_requests",
        customer_id: cust.alias,
        timestamp: new Date(monthStart.getTime() + i * 60_000).toISOString(),
        properties: {
          endpoint: i % 4 === 0 ? "/v1/search" : i % 4 === 1 ? "/v1/usage" : i % 4 === 2 ? "/v1/events" : "/v1/customers",
        },
      });
    }
    for (let offset = 0; offset < events.length; offset += 100) {
      try {
        await ingestEvents(ctx, {
          events: events.slice(offset, offset + 100),
          allow_backfilling: true,
          allow_partial_failures: true,
        });
      } catch (e: any) {
        // Ignore duplicate event errors
      }
    }
  }
  console.log(`Usage events: ~${eventCount * customers.length} ingested`);

  // Generate invoices for active subscriptions
  const activeSubs = await Subscription.find({ tenantId: ctx.tenantId, status: "ACTIVE" });
  for (const sub of activeSubs) {
    const existingInvoice = await Invoice.findOne({ tenantId: ctx.tenantId, subscriptionId: String(sub._id) });
    if (existingInvoice) continue;
    try {
      await generateInvoices(ctx, {
        subscriptionId: String(sub._id),
        periodStart: monthStart.toISOString(),
        periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
        finalize: true,
      });
      console.log(`  Invoice generated for subscription ${String(sub._id)}`);
    } catch (e: any) {
      console.log(`  Invoice generation failed: ${e.message}`);
    }
  }

  await OrganizationMember.updateOne(
    { orgId: ctx.orgId, userId: ctx.userId },
    { $setOnInsert: { role: "owner" } },
    { upsert: true },
  );

  console.log("\nAnsh seed complete");
  console.log(`Login: anshgupta022007@gmail.com`);
  console.log(`Tenant: ${ctx.tenantId}`);
  console.log(`Plans: ${[starter, growth, scale].map((p) => p?.alias).join(", ")}`);
  console.log(`Customers: ${customers.map((c) => c.alias).join(", ")}`);
} finally {
  await database.stop();
  await mongoose.disconnect().catch(() => undefined);
}
