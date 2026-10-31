import mongoose from "mongoose";
import { BillableMetric, Feature, Product, ProductFamily, User } from "@brightloop/db";
import { loadConfig } from "../config/env.js";
import { startDatabase } from "../lib/database.js";
import { hashPassword } from "../services/auth-service.js";
import { createOrganization, tenantSlug } from "../services/organization-service.js";
import { createPlan, publishPlan } from "../services/plan-service.js";
import { createSubscription } from "../services/subscription-service.js";
import { ingestEvents } from "../services/metering-service.js";
import { generateInvoices } from "../services/invoice-service.js";

const config = loadConfig();
const database = await startDatabase(config);

const RANDOM_EVENT_BATCH_SIZE = 100;

interface TierSeed {
  name: string;
  alias: string;
  base: string;
  usage: string;
  rank: number;
  trialDays: number;
  limit: number;
}

const TIERS: Record<string, TierSeed> = {
  starter: { name: "Starter", alias: "starter", base: "49.00", usage: "0.01", rank: 1, trialDays: 14, limit: 10_000 },
  growth: { name: "Growth", alias: "growth", base: "199.00", usage: "0.008", rank: 2, trialDays: 14, limit: 100_000 },
  scale: { name: "Scale", alias: "scale", base: "749.00", usage: "0.005", rank: 3, trialDays: 7, limit: 1_000_000 },
};

interface CustomerSeed {
  alias: string;
  name: string;
  billingEmail: string;
  country: string;
  city: string;
}

interface OrgSeed {
  name: string;
  slug: string;
  currency: string;
  tier: keyof typeof TIERS;
  customers: CustomerSeed[];
}

const ORG_SEEDS: OrgSeed[] = [
  {
    name: "Apex Dynamics",
    slug: "apex-dynamics",
    currency: "USD",
    tier: "growth",
    customers: [
      { alias: "acme-robotics", name: "Acme Robotics", billingEmail: "billing@acme-robotics.com", country: "US", city: "Detroit" },
      { alias: "globex-energy", name: "Globex Energy", billingEmail: "finance@globexenergy.com", country: "DE", city: "Hamburg" },
    ],
  },
  {
    name: "BluePeak Health",
    slug: "bluepeak-health",
    currency: "EUR",
    tier: "starter",
    customers: [
      { alias: "helix-bio", name: "Helix Bio", billingEmail: "billing@helixbio.eu", country: "NL", city: "Amsterdam" },
      { alias: "meridian-meds", name: "Meridian Medical", billingEmail: "accounts@meridianmeds.com", country: "US", city: "Boston" },
    ],
  },
  {
    name: "Cinder and Oak Logistics",
    slug: "cinder-oak-logistics",
    currency: "GBP",
    tier: "scale",
    customers: [
      { alias: "falcon-freight", name: "Falcon Freight Group", billingEmail: "ap@falconfreight.co.uk", country: "GB", city: "London" },
      { alias: "ironclad-shipping", name: "Ironclad Shipping", billingEmail: "billing@ironcladshipping.com", country: "US", city: "Houston" },
    ],
  },
];

const ENDPOINTS = ["/v1/events", "/v1/usage", "/v1/search", "/v1/subscriptions", "/v1/invoices"];

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function seedTenant(org: OrgSeed) {
  const tier = TIERS[org.tier];
  const user = await User.create({
    email: `${org.slug}@brightloop.local`,
    passwordHash: await hashPassword("Demo1234"),
    name: `${org.name} Owner`,
    emailVerifiedAt: new Date(),
  });

  const created = await createOrganization(String(user._id), {
    name: org.name,
    slug: org.slug,
    tenant_name: org.name,
    currency: org.currency,
  });
  const tenantContext = {
    tenantId: String(created.tenant._id),
    orgId: String(created.org._id),
    userId: String(user._id),
    role: "owner" as const,
    actorId: String(user._id),
  };

  const family = await ProductFamily.create({
    tenantId: tenantContext.tenantId,
    name: "Core platform",
    alias: "core",
  });
  const platform = await Product.create({
    tenantId: tenantContext.tenantId,
    familyId: String(family._id),
    name: "Platform access",
    alias: "platform-access",
    feeType: "RATE",
    description: "Core platform subscription",
  });
  const overage = await Product.create({
    tenantId: tenantContext.tenantId,
    familyId: String(family._id),
    name: `${tier.name} overage`,
    alias: `${tier.alias}-overage`,
    feeType: "USAGE",
    description: `${tier.name} usage overage`,
  });

  const apiFeature = await Feature.create({
    tenantId: tenantContext.tenantId,
    name: "API calls",
    code: "api_calls",
    featureType: "BOOLEAN",
  });
  const requestFeature = await Feature.create({
    tenantId: tenantContext.tenantId,
    name: "API requests",
    code: "api_requests",
    featureType: "METERED",
  });
  const metric = await BillableMetric.create({
    tenantId: tenantContext.tenantId,
    name: "API requests",
    code: "api_requests",
    aggregation: "COUNT",
    field: null,
    segmentationKeys: ["endpoint"],
  });

  const plan = await createPlan(tenantContext, {
    name: tier.name,
    alias: tier.alias,
    description: `${tier.name} subscription plan`,
    plan_type: "STANDARD",
    product_family_id: String(family._id),
    currency: org.currency,
    billing_period: "MONTHLY",
    billing_type: "ADVANCE",
    net_terms: 30,
    trial_days: tier.trialDays,
    self_service_rank: tier.rank,
    components: [
      {
        product_id: String(platform._id),
        metric_id: null,
        name: "Platform access",
        fee_type: "RATE",
        billing_period: "MONTHLY",
        billing_type: "ADVANCE",
        pricing: { type: "FLAT", rate: tier.base },
        order: 0,
      },
      {
        product_id: String(overage._id),
        metric_id: String(metric._id),
        name: "API request overage",
        fee_type: "USAGE",
        billing_period: "MONTHLY",
        billing_type: "ARREARS",
        pricing: { type: "PER_UNIT", rate: tier.usage },
        order: 1,
      },
    ],
    entitlements: [
      { feature_id: String(apiFeature._id), value: { type: "BOOLEAN", enabled: true } },
      {
        feature_id: String(requestFeature._id),
        value: { type: "METERED", limit: tier.limit, reset_period: { type: "BILLING_CYCLE" } },
      },
    ],
  });
  await publishPlan(tenantContext, String(plan._id), {});

  const subscriptions: Array<{ customer: CustomerSeed; subscriptionId: string }> = [];
  for (const customerSeed of org.customers) {
    const customer = await createCustomer(tenantContext, {
      alias: customerSeed.alias,
      name: customerSeed.name,
      billing_email: customerSeed.billingEmail,
      phone: `+1 555 ${String(randomInt(1000, 9999))}`,
      vat_number: `${org.currency.slice(0, 2).toUpperCase()}-${customerSeed.alias.toUpperCase().replace(/[^A-Z0-9]/g, "") || "CUST"}-${String(randomInt(100, 999))}`,
      currency: org.currency,
      billing_address: {
        line1: `${randomInt(1, 900)} ${customerSeed.city} Street`,
        city: customerSeed.city,
        state: customerSeed.country === "US" ? "CA" : "",
        postal_code: String(randomInt(10000, 99999)),
        country: customerSeed.country,
      },
      custom_taxes: [{ name: "Sales tax", rate: "8.25" }],
      is_tax_exempt: false,
    });

    const subscription = await createSubscription(tenantContext, {
      plan_id: String(plan._id),
      customer_id_or_alias: customerSeed.alias,
      activation_condition: "ON_START",
      trial_days: Math.random() < 0.35 ? tier.trialDays : 0,
      billing_day_anchor: 1,
      net_terms: 30,
      coupon_codes: [],
      add_ons: [],
      auto_advance_invoices: true,
      charge_automatically: false,
      start_date: new Date().toISOString(),
      purchase_order: `PO-${org.slug.toUpperCase()}-${String(randomInt(1000, 9999))}`,
      invoice_memo: "Net 30 terms apply.",
    });
    subscriptions.push({ customer: customerSeed, subscriptionId: String(subscription._id) });

    const eventCount = randomInt(40, 160);
    const events = [];
    const windowStart = Date.now() - 29 * 86_400_000;
    for (let index = 0; index < eventCount; index += 1) {
      events.push({
        event_id: `${tenantContext.tenantId}-${customerSeed.alias}-${index}`,
        code: "api_requests",
        customer_id: customerSeed.alias,
        timestamp: new Date(windowStart + Math.random() * 29 * 86_400_000).toISOString(),
        properties: { endpoint: ENDPOINTS[randomInt(0, ENDPOINTS.length - 1)] ?? "/v1/events" },
      });
    }
    for (let offset = 0; offset < events.length; offset += RANDOM_EVENT_BATCH_SIZE) {
      await ingestEvents(tenantContext, {
        events: events.slice(offset, offset + RANDOM_EVENT_BATCH_SIZE),
        allow_backfilling: true,
        allow_partial_failures: true,
      });
    }

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const invoices = await generateInvoices(tenantContext, {
      subscriptionId,
      periodStart: monthStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      finalize: true,
    });
    return { customer: customerSeed, subscriptionId: String(subscription._id), invoices };
  }
}

try {
  for (const org of ORG_SEEDS) {
    for (const entry of await seedTenant(org)) {
      console.log(
        `seeded ${org.name} / ${entry.customer.name} subscription=${entry.subscriptionId} invoices=${entry.invoices.length}`,
      );
    }
  }
  console.log("BrightLoop random seed complete");
} finally {
  await database.stop();
  await mongoose.disconnect().catch(() => undefined);
}
