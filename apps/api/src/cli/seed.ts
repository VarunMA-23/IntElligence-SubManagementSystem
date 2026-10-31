import mongoose from "mongoose";
import {
  AddOn,
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
  Webhook,
} from "@brightloop/db";
import { loadConfig } from "../config/env.js";
import { startDatabase } from "../lib/database.js";
import { hashPassword } from "../services/auth-service.js";
import { createOrganization } from "../services/organization-service.js";
import { createPlan, publishPlan } from "../services/plan-service.js";
import { createSubscription } from "../services/subscription-service.js";
import { ingestEvents } from "../services/metering-service.js";
import { generateInvoices } from "../services/invoice-service.js";
import { encryptSecret } from "@brightloop/integrations";

console.log("Starting comprehensive BrightLoop test data seed...");
const config = loadConfig();
const database = await startDatabase(config);

try {
  // 1. Primary Demo User & Additional Team Members
  console.log("Creating users and organization...");
  let user = await User.findOne({ email: "demo@brightloop.local" });
  if (!user) {
    user = await User.create({
      email: "demo@brightloop.local",
      passwordHash: await hashPassword("Demo1234"),
      name: "BrightLoop Demo Admin",
      emailVerifiedAt: new Date(),
    });
  } else {
    user.passwordHash = await hashPassword("Demo1234");
    user.emailVerifiedAt = new Date();
    await user.save();
  }

  // Secondary users for team testing
  let memberUser = await User.findOne({ email: "member@brightloop.local" });
  if (!memberUser) {
    memberUser = await User.create({
      email: "member@brightloop.local",
      passwordHash: await hashPassword("Demo1234"),
      name: "Alice Developer",
      emailVerifiedAt: new Date(),
    });
  }

  let viewerUser = await User.findOne({ email: "viewer@brightloop.local" });
  if (!viewerUser) {
    viewerUser = await User.create({
      email: "viewer@brightloop.local",
      passwordHash: await hashPassword("Demo1234"),
      name: "Bob Finance Analyst",
      emailVerifiedAt: new Date(),
    });
  }

  // 2. Organization & Tenant
  let org = await Organization.findOne({ slug: "brightloop-demo" });
  let tenant: any;
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
  if (!tenant) throw new Error("Seed tenant not found");

  const ctx = {
    tenantId: String(tenant._id),
    orgId: String(org._id),
    userId: String(user._id),
    role: "owner" as const,
    actorId: String(user._id),
  };

  // Add members to org
  await OrganizationMember.updateOne(
    { orgId: ctx.orgId, userId: ctx.userId },
    { $set: { role: "owner" } },
    { upsert: true }
  );
  await OrganizationMember.updateOne(
    { orgId: ctx.orgId, userId: String(memberUser._id) },
    { $set: { role: "member" } },
    { upsert: true }
  );
  await OrganizationMember.updateOne(
    { orgId: ctx.orgId, userId: String(viewerUser._id) },
    { $set: { role: "viewer" } },
    { upsert: true }
  );

  // 3. Invoicing Entities (US & EU)
  console.log("Setting up invoicing entities...");
  const usEntity =
    (await InvoicingEntity.findOne({ tenantId: ctx.tenantId, name: "BrightLoop Inc. (US)" })) ??
    (await InvoicingEntity.create({
      tenantId: ctx.tenantId,
      name: "BrightLoop Inc. (US)",
      legalName: "BrightLoop Technologies Inc.",
      address: {
        line1: "100 Market Street, Suite 400",
        city: "San Francisco",
        state: "CA",
        postal_code: "94105",
        country: "US",
      },
      taxId: "US-94-3829104",
      defaultCurrency: "USD",
      netTerms: 30,
      isDefault: true,
    }));

  const euEntity =
    (await InvoicingEntity.findOne({ tenantId: ctx.tenantId, name: "BrightLoop Europe B.V." })) ??
    (await InvoicingEntity.create({
      tenantId: ctx.tenantId,
      name: "BrightLoop Europe B.V.",
      legalName: "BrightLoop Europe B.V.",
      address: {
        line1: "Keizersgracht 421",
        city: "Amsterdam",
        state: "NH",
        postal_code: "1016 EK",
        country: "NL",
      },
      taxId: "NL861234567B01",
      defaultCurrency: "EUR",
      netTerms: 15,
      isDefault: false,
    }));

  // 4. Product Families
  console.log("Setting up catalog (families, products, metrics, features)...");
  let platformFamily = await ProductFamily.findOne({ tenantId: ctx.tenantId, alias: "platform" });
  if (!platformFamily) {
    platformFamily = await ProductFamily.create({
      tenantId: ctx.tenantId,
      name: "Cloud Platform",
      alias: "platform",
    });
  }

  let aiFamily = await ProductFamily.findOne({ tenantId: ctx.tenantId, alias: "ai-services" });
  if (!aiFamily) {
    aiFamily = await ProductFamily.create({
      tenantId: ctx.tenantId,
      name: "AI & Intelligence Suite",
      alias: "ai-services",
    });
  }

  // 5. Products
  async function ensureProduct(familyId: string, alias: string, name: string, feeType: string, description: string) {
    let p = await Product.findOne({ tenantId: ctx.tenantId, alias });
    if (!p) {
      p = await Product.create({
        tenantId: ctx.tenantId,
        familyId,
        name,
        alias,
        feeType,
        description,
      });
    }
    return p;
  }

  const prodPlatform = await ensureProduct(String(platformFamily._id), "platform-core", "Core Platform Access", "RATE", "Base workspace access");
  const prodApiUsage = await ensureProduct(String(platformFamily._id), "api-usage", "API Requests Metered", "USAGE", "Per-request API metering");
  const prodAiCompute = await ensureProduct(String(aiFamily._id), "ai-tokens", "AI Model Tokens", "USAGE", "LLM inference token volume");
  const prodDedicatedIp = await ensureProduct(String(platformFamily._id), "dedicated-ip", "Dedicated Ingress IP", "RATE", "Add-on dedicated IP");

  // 6. Features
  async function ensureFeature(code: string, name: string, type: "BOOLEAN" | "METERED") {
    let f = await Feature.findOne({ tenantId: ctx.tenantId, code });
    if (!f) {
      f = await Feature.create({ tenantId: ctx.tenantId, code, name, featureType: type });
    }
    return f;
  }

  const featSso = await ensureFeature("sso_login", "SAML / OIDC Single Sign-On", "BOOLEAN");
  const featCustomDomains = await ensureFeature("custom_domains", "Custom Domain Mapping", "BOOLEAN");
  const featApiRequests = await ensureFeature("api_requests", "Monthly API Requests", "METERED");
  const featAiTokens = await ensureFeature("ai_tokens", "Monthly AI Tokens", "METERED");

  // 7. Billable Metrics
  async function ensureMetric(code: string, name: string, aggregation: string, field: string | null, keys: string[]) {
    let m = await BillableMetric.findOne({ tenantId: ctx.tenantId, code });
    if (!m) {
      m = await BillableMetric.create({
        tenantId: ctx.tenantId,
        code,
        name,
        aggregation,
        field,
        segmentationKeys: keys,
      });
    }
    return m;
  }

  const metricApi = await ensureMetric("api_requests", "API Request Count", "COUNT", null, ["endpoint", "method", "status"]);
  const metricAiTokens = await ensureMetric("ai_tokens", "AI Token Usage", "SUM", "tokens", ["model", "region"]);

  // 8. Add-Ons
  let addOnDedicatedIp = await AddOn.findOne({ tenantId: ctx.tenantId, alias: "addon-dedicated-ip" });
  if (!addOnDedicatedIp) {
    addOnDedicatedIp = await AddOn.create({
      tenantId: ctx.tenantId,
      alias: "addon-dedicated-ip",
      name: "Dedicated Static IP",
      productId: String(prodDedicatedIp._id),
      description: "High-reputation static IP for enterprise API pipelines",
      selfServiceable: true,
      pricing: { type: "FLAT", rate: "25.00" },
      entitlements: [],
    });
  }

  // 9. Plans (Starter, Growth, Enterprise)
  console.log("Configuring plans and pricing tiers...");
  async function createOrGetPlan(planDef: {
    alias: string;
    name: string;
    description: string;
    baseRate: string;
    trialDays: number;
    rank: number;
    components: any[];
    entitlements: any[];
  }) {
    let planRecord = await Plan.findOne({ tenantId: ctx.tenantId, alias: planDef.alias });
    if (!planRecord) {
      planRecord = await createPlan(ctx, {
        name: planDef.name,
        alias: planDef.alias,
        description: planDef.description,
        plan_type: "STANDARD",
        product_family_id: String(platformFamily!._id),
        currency: "USD",
        billing_period: "MONTHLY",
        billing_type: "ADVANCE",
        net_terms: 30,
        trial_days: planDef.trialDays,
        self_service_rank: planDef.rank,
        components: planDef.components,
        entitlements: planDef.entitlements,
      });
      await publishPlan(ctx, String(planRecord._id), {});
      planRecord = (await Plan.findById(planRecord._id))!;
    }
    return planRecord;
  }

  const starterPlan = await createOrGetPlan({
    alias: "starter",
    name: "Developer Starter",
    description: "Ideal for small teams and early-stage prototypes",
    baseRate: "29.00",
    trialDays: 14,
    rank: 1,
    components: [
      {
        product_id: String(prodPlatform._id),
        metric_id: null,
        name: "Developer Base Access",
        fee_type: "RATE",
        billing_period: "MONTHLY",
        billing_type: "ADVANCE",
        pricing: { type: "FLAT", rate: "29.00" },
        order: 0,
      },
      {
        product_id: String(prodApiUsage._id),
        metric_id: String(metricApi._id),
        name: "Standard API Invocations",
        fee_type: "USAGE",
        billing_period: "MONTHLY",
        billing_type: "ARREARS",
        pricing: { type: "PER_UNIT", rate: "0.005" },
        order: 1,
      },
    ],
    entitlements: [
      { feature_id: String(featSso._id), value: { type: "BOOLEAN", enabled: false } },
      { feature_id: String(featCustomDomains._id), value: { type: "BOOLEAN", enabled: false } },
      { feature_id: String(featApiRequests._id), value: { type: "METERED", limit: 25000, reset_period: { type: "BILLING_CYCLE" } } },
    ],
  });

  const growthPlan = await createOrGetPlan({
    alias: "growth",
    name: "Growth Pro",
    description: "Designed for scaling products needing higher volume & AI compute",
    baseRate: "149.00",
    trialDays: 14,
    rank: 2,
    components: [
      {
        product_id: String(prodPlatform._id),
        metric_id: null,
        name: "Growth Base Access",
        fee_type: "RATE",
        billing_period: "MONTHLY",
        billing_type: "ADVANCE",
        pricing: { type: "FLAT", rate: "149.00" },
        order: 0,
      },
      {
        product_id: String(prodApiUsage._id),
        metric_id: String(metricApi._id),
        name: "Growth Tier API Invocations",
        fee_type: "USAGE",
        billing_period: "MONTHLY",
        billing_type: "ARREARS",
        pricing: { type: "PER_UNIT", rate: "0.002" },
        order: 1,
      },
      {
        product_id: String(prodAiCompute._id),
        metric_id: String(metricAiTokens._id),
        name: "AI LLM Tokens",
        fee_type: "USAGE",
        billing_period: "MONTHLY",
        billing_type: "ARREARS",
        pricing: { type: "PER_UNIT", rate: "0.00002" },
        order: 2,
      },
    ],
    entitlements: [
      { feature_id: String(featSso._id), value: { type: "BOOLEAN", enabled: true } },
      { feature_id: String(featCustomDomains._id), value: { type: "BOOLEAN", enabled: true } },
      { feature_id: String(featApiRequests._id), value: { type: "METERED", limit: 250000, reset_period: { type: "BILLING_CYCLE" } } },
      { feature_id: String(featAiTokens._id), value: { type: "METERED", limit: 5000000, reset_period: { type: "BILLING_CYCLE" } } },
    ],
  });

  const enterprisePlan = await createOrGetPlan({
    alias: "enterprise",
    name: "Enterprise Dedicated",
    description: "Mission-critical infrastructure with custom SLA and volume pricing",
    baseRate: "599.00",
    trialDays: 0,
    rank: 3,
    components: [
      {
        product_id: String(prodPlatform._id),
        metric_id: null,
        name: "Enterprise Base Platform",
        fee_type: "RATE",
        billing_period: "MONTHLY",
        billing_type: "ADVANCE",
        pricing: { type: "FLAT", rate: "599.00" },
        order: 0,
      },
      {
        product_id: String(prodApiUsage._id),
        metric_id: String(metricApi._id),
        name: "Enterprise Volume API",
        fee_type: "USAGE",
        billing_period: "MONTHLY",
        billing_type: "ARREARS",
        pricing: { type: "PER_UNIT", rate: "0.001" },
        order: 1,
      },
      {
        product_id: String(prodAiCompute._id),
        metric_id: String(metricAiTokens._id),
        name: "Enterprise AI Inference Tokens",
        fee_type: "USAGE",
        billing_period: "MONTHLY",
        billing_type: "ARREARS",
        pricing: { type: "PER_UNIT", rate: "0.00001" },
        order: 2,
      },
    ],
    entitlements: [
      { feature_id: String(featSso._id), value: { type: "BOOLEAN", enabled: true } },
      { feature_id: String(featCustomDomains._id), value: { type: "BOOLEAN", enabled: true } },
      { feature_id: String(featApiRequests._id), value: { type: "METERED", limit: 5000000, reset_period: { type: "BILLING_CYCLE" } } },
      { feature_id: String(featAiTokens._id), value: { type: "METERED", limit: 50000000, reset_period: { type: "BILLING_CYCLE" } } },
    ],
  });

  // 10. Discount Coupons
  console.log("Setting up promotional coupons...");
  async function ensureCoupon(code: string, description: string, discount: any) {
    let c = await Coupon.findOne({ tenantId: ctx.tenantId, code });
    if (!c) {
      c = await Coupon.create({
        tenantId: ctx.tenantId,
        code,
        description,
        discount,
        reusable: true,
        redemptionLimit: null,
        planIds: [],
      });
    }
    return c;
  }

  await ensureCoupon("WELCOME25", "25% discount for first 3 months", { type: "PERCENTAGE", percentage: "25" });
  await ensureCoupon("FLAT50OFF", "$50 flat discount", { type: "FIXED", amount: "50.00", currency: "USD" });

  // 11. Diverse Customers
  console.log("Creating multiple diverse customers...");
  async function ensureCustomer(alias: string, name: string, email: string, vat: string, entityId: string, city: string, state: string, country: string) {
    let c = await Customer.findOne({ tenantId: ctx.tenantId, alias });
    if (!c) {
      c = await Customer.create({
        tenantId: ctx.tenantId,
        alias,
        name,
        invoicingEmails: [email],
        billingEmail: email,
        phone: "+1 555 0199",
        vatNumber: vat,
        currency: "USD",
        invoicingEntityId: entityId,
        billingAddress: {
          line1: `100 ${name} Blvd`,
          city,
          state,
          postal_code: "90210",
          country,
        },
        customTaxes: [{ name: "Standard Tax", rate: "8.00" }],
        isTaxExempt: false,
      });
    }
    return c;
  }

  const custAcme = await ensureCustomer("acme-corp", "Acme Corporation", "finance@acme.com", "US-ACME-991", String(usEntity._id), "San Jose", "CA", "US");
  const custCyber = await ensureCustomer("cyber-dynamics", "Cyber Dynamics LLC", "billing@cyberdynamics.io", "US-CYBER-404", String(usEntity._id), "New York", "NY", "US");
  const custNova = await ensureCustomer("nova-labs", "Nova AI Labs", "accounting@novalabs.ai", "US-NOVA-882", String(usEntity._id), "Austin", "TX", "US");
  const custEuro = await ensureCustomer("euro-retail", "EuroRetail Group B.V.", "accounts@euroretail.eu", "NL992384712B01", String(euEntity._id), "Rotterdam", "ZH", "NL");

  // 12. Subscriptions for Each Customer
  console.log("Assigning active subscriptions...");
  async function ensureSub(customerId: string, alias: string, planId: string, po: string) {
    let sub = await Subscription.findOne({
      tenantId: ctx.tenantId,
      customerId,
      status: { $in: ["ACTIVE", "TRIAL_ACTIVE"] },
    });
    if (!sub) {
      sub = await createSubscription(ctx, {
        plan_id: planId,
        customer_id_or_alias: alias,
        activation_condition: "ON_START",
        trial_days: 0,
        billing_day_anchor: 1,
        net_terms: 30,
        coupon_codes: [],
        add_ons: [],
        auto_advance_invoices: true,
        charge_automatically: false,
        start_date: new Date().toISOString(),
        purchase_order: po,
        invoice_memo: `Monthly services subscription for ${alias}`,
      });
    }
    return sub;
  }

  const subAcme = await ensureSub(String(custAcme._id), "acme-corp", String(starterPlan._id), "PO-ACME-2026");
  const subCyber = await ensureSub(String(custCyber._id), "cyber-dynamics", String(growthPlan._id), "PO-CYBER-991");
  const subNova = await ensureSub(String(custNova._id), "nova-labs", String(enterprisePlan._id), "PO-NOVA-5541");

  // 13. Rich Metering & Usage Events
  console.log("Simulating real-world API & AI usage events...");
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Ingest API request events for Acme & Cyber
  const apiEvents: any[] = [];
  for (let i = 0; i < 350; i++) {
    apiEvents.push({
      event_id: `api-seed-acme-${i}`,
      code: "api_requests",
      customer_id: "acme-corp",
      timestamp: new Date(monthStart.getTime() + i * 45_000).toISOString(),
      properties: {
        endpoint: i % 4 === 0 ? "/api/v1/search" : i % 4 === 1 ? "/api/v1/invoices" : "/api/v1/customers",
        status: 200,
      },
    });
  }

  for (let i = 0; i < 600; i++) {
    apiEvents.push({
      event_id: `api-seed-cyber-${i}`,
      code: "api_requests",
      customer_id: "cyber-dynamics",
      timestamp: new Date(monthStart.getTime() + i * 30_000).toISOString(),
      properties: {
        endpoint: "/api/v1/telemetry",
        status: 200,
      },
    });
  }

  // AI Inference Token events for Nova Labs
  const aiEvents: any[] = [];
  for (let i = 0; i < 200; i++) {
    aiEvents.push({
      event_id: `ai-seed-nova-${i}`,
      code: "ai_tokens",
      customer_id: "nova-labs",
      timestamp: new Date(monthStart.getTime() + i * 60_000).toISOString(),
      properties: {
        tokens: 1500 + (i % 10) * 200,
        model: i % 2 === 0 ? "gpt-4o" : "claude-3-5-sonnet",
        region: "us-east-1",
      },
    });
  }

  const allEvents = [...apiEvents, ...aiEvents];
  for (let offset = 0; offset < allEvents.length; offset += 100) {
    await ingestEvents(ctx, {
      events: allEvents.slice(offset, offset + 100),
      allow_backfilling: true,
      allow_partial_failures: true,
    });
  }

  // 14. Generated & Finalized Invoices
  console.log("Generating finalized invoices for subscriptions...");
  const subs = [subAcme, subCyber, subNova];
  for (const sub of subs) {
    const existing = await Invoice.findOne({ tenantId: ctx.tenantId, subscriptionId: String(sub._id) });
    if (!existing) {
      try {
        await generateInvoices(ctx, {
          subscriptionId: String(sub._id),
          periodStart: monthStart.toISOString(),
          periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
          finalize: true,
        });
      } catch (err) {
        console.warn(`Invoice generation note for ${sub._id}: ${(err as Error).message}`);
      }
    }
  }

  // 15. Webhook Endpoints
  let wh = await Webhook.findOne({ tenantId: ctx.tenantId });
  if (!wh) {
    wh = await Webhook.create({
      tenantId: ctx.tenantId,
      url: "https://api.acme.example/webhooks/brightloop",
      secretCipher: encryptSecret("whsec_demo_secret_token_brightloop", config.INTERNAL_SECRET),
      events: ["invoice.finalized", "subscription.created", "customer.created"],
      enabled: true,
    });
  }

  console.log("\n=======================================================");
  console.log("🎉 Complete Test Database Seed Prepared Successfully!");
  console.log("=======================================================");
  console.log("🔑 Primary Admin Login:");
  console.log("   Email:    demo@brightloop.local");
  console.log("   Password: Demo1234");
  console.log("   Tenant:   " + ctx.tenantId);
  console.log("\n👥 Additional Team Accounts (password: Demo1234):");
  console.log("   - member@brightloop.local (Alice Developer, Member role)");
  console.log("   - viewer@brightloop.local (Bob Finance Analyst, Viewer role)");
  console.log("\n🏢 Seeded Customers:");
  console.log("   1. acme-corp       -> Acme Corporation (Starter Plan + API events)");
  console.log("   2. cyber-dynamics  -> Cyber Dynamics LLC (Growth Plan + High API usage)");
  console.log("   3. nova-labs       -> Nova AI Labs (Enterprise Plan + AI Token usage)");
  console.log("   4. euro-retail     -> EuroRetail Group B.V. (EU Entity)");
  console.log("\n📦 Plans & Add-ons:");
  console.log("   - Developer Starter ($29/mo)");
  console.log("   - Growth Pro ($149/mo)");
  console.log("   - Enterprise Dedicated ($599/mo)");
  console.log("   - Dedicated Static IP Add-on ($25/mo)");
  console.log("\n🏷️ Coupons:");
  console.log("   - WELCOME25 (25% off)");
  console.log("   - FLAT50OFF ($50 off)");
  console.log("=======================================================\n");
} catch (error) {
  console.error("Seed failed with error:", error);
  throw error;
} finally {
  await database.stop();
  await mongoose.disconnect().catch(() => undefined);
}
