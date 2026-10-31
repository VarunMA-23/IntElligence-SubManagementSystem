import request from "supertest";
import { createApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config/env.js";
import { startDatabase } from "../apps/api/src/lib/database.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke check failed: ${message}`);
}

async function main() {
  const config = loadConfig({
    NODE_ENV: "test",
    USE_MEMORY_DB: "true",
    RATE_LIMIT_MAX: "10000",
    MAILER_TRANSPORT: "console",
  });
  const database = await startDatabase(config);
  const app = createApp(config);
  const client = request(app);
  const email = `smoke_${Date.now()}@brightloop.test`;

  try {
    const health = await client.get("/health").expect(200);
    assert(health.body.status === "ok", "health should be ok");

    const registration = await client
      .post("/api/v1/auth/register")
      .send({ email, password: "SmokeTest1234", name: "Smoke Tester" });
    if (registration.status !== 201) {
      console.error("register failed", registration.status, registration.body);
    }
    assert(registration.status === 201, "registration should return 201");
    const verifyToken = registration.body.verification_token_hint;
    assert(verifyToken, "verification token hint should be returned in console mode");

    await client.post("/api/v1/auth/verify-email").send({ token: verifyToken }).expect(200);
    const login = await client.post("/api/v1/auth/login").send({ email, password: "SmokeTest1234" }).expect(200);
    const bootstrapToken = login.body.access_token;

    const organization = await client
      .post("/api/v1/auth/organizations")
      .set("authorization", `Bearer ${bootstrapToken}`)
      .send({ name: "Smoke Labs", slug: `smoke-${Date.now()}`, tenant_name: "Production", currency: "USD" })
      .expect(201);
    const token = organization.body.access_token;
    const auth = { authorization: `Bearer ${token}` };

    const me = await client.get("/api/v1/auth/me").set(auth).expect(200);
    assert(me.body.user.email === email, "me should return the registered user");

    const customer = await client
      .post("/api/v1/customers")
      .set(auth)
      .send({
        alias: "smoke-customer",
        name: "Smoke Customer",
        invoicing_emails: ["billing@smoke.test"],
        currency: "USD",
        custom_taxes: [],
        is_tax_exempt: false,
      })
      .expect(201);

    const family = await client
      .post("/api/v1/product-families")
      .set(auth)
      .send({ name: "Smoke Family", alias: `smoke-family-${Date.now()}` })
      .expect(201);

    const metric = await client
      .post("/api/v1/metrics")
      .set(auth)
      .send({ name: "API requests", code: `api_requests_${Date.now()}`, aggregation: "SUM", field: "value", segmentation_keys: [] })
      .expect(201);

    const plan = await client
      .post("/api/v1/plans")
      .set(auth)
      .send({
        name: "Smoke Plan",
        alias: `smoke-plan-${Date.now()}`,
        description: "End-to-end smoke plan",
        plan_type: "STANDARD",
        product_family_id: family.body.id,
        currency: "USD",
        billing_period: "MONTHLY",
        billing_type: "ADVANCE",
        net_terms: 30,
        trial_days: 0,
        components: [
          {
            name: "Platform access",
            fee_type: "RATE",
            billing_period: "MONTHLY",
            billing_type: "ADVANCE",
            pricing: { type: "FLAT", rate: "99.00" },
            order: 0,
          },
          {
            metric_id: metric.body.id,
            name: "API requests",
            fee_type: "USAGE",
            billing_period: "MONTHLY",
            billing_type: "ARREARS",
            pricing: { type: "PER_UNIT", rate: "0.01" },
            order: 1,
          },
        ],
        entitlements: [],
      })
      .expect(201);

    await client.post(`/api/v1/plans/${plan.body.id}/publish`).set(auth).send({}).expect(200);

    const subscription = await client
      .post("/api/v1/subscriptions")
      .set(auth)
      .send({
        plan_id: plan.body.id,
        customer_id_or_alias: customer.body.id,
        start_date: new Date().toISOString().slice(0, 10),
        activation_condition: "ON_START",
        trial_days: 0,
        billing_day_anchor: 1,
        net_terms: 30,
        coupon_codes: [],
        add_ons: [],
        auto_advance_invoices: true,
        charge_automatically: false,
      });
    if (subscription.status !== 201) {
      console.error("subscription failed", subscription.status, subscription.body);
    }
    assert(subscription.status === 201, "subscription should be created");

    const eventCode = metric.body.code;
    const now = new Date().toISOString();
    await client
      .post("/api/v1/events")
      .set(auth)
      .send({
        events: [
          { event_id: `evt_${Date.now()}_1`, code: eventCode, customer_id: customer.body.id, timestamp: now, properties: { value: "25" } },
          { event_id: `evt_${Date.now()}_2`, code: eventCode, customer_id: customer.body.id, timestamp: now, properties: { value: "75" } },
        ],
        allow_backfilling: false,
        allow_partial_failures: false,
      })
      .expect(202);

    const usage = await client.get(`/api/v1/customers/${customer.body.id}/usage`).set(auth).expect(200);
    const usageRow = usage.body.data.find((row: any) => row.metric_code === eventCode);
    assert(usageRow?.total_value === "100", `usage should aggregate to 100, got ${usageRow?.total_value}`);

    const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
    const periodEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

    const generated = await client
      .post("/api/v1/invoices/generate")
      .set(auth)
      .send({ subscription_id: subscription.body.id, period_start: periodStart, period_end: periodEnd, finalize: true })
      .expect(201);

    const invoice = generated.body.data[0];
    assert(invoice, "an invoice should be generated");
    assert(invoice.status === "FINALIZED", "invoice should be finalized");
    assert(invoice.subtotal >= 10_000, `subtotal should include the base fee, got ${invoice.subtotal}`);

    const invoiceDetail = await client.get(`/api/v1/invoices/${invoice.id}`).set(auth).expect(200);
    assert(invoiceDetail.body.line_items.length >= 2, "invoice should include base and usage lines");

    const credit = await client
      .post(`/api/v1/invoices/${invoice.id}/credit-notes`)
      .set(auth)
      .send({ total: "10.00", reason: "Smoke credit" })
      .expect(201);
    assert(credit.body.credit_note_number, "credit note should be numbered");

    const pdf = await client.get(`/api/v1/invoices/${invoice.id}/pdf`).set(auth).expect(200);
    assert(pdf.headers["content-type"]?.includes("application/pdf"), "invoice pdf should be served");

    const list = await client.get("/api/v1/invoices").set(auth).expect(200);
    assert(list.body.meta.total >= 1, "invoice list should include the generated invoice");

    console.log("Smoke API flow passed");
    console.log(`  organization: ${organization.body.organization.name}`);
    console.log(`  customer: ${customer.body.alias}`);
    console.log(`  plan: ${plan.body.name}`);
    console.log(`  subscription: ${subscription.body.id}`);
    console.log(`  invoice: ${invoice.invoice_number} total=${invoice.total}`);
    console.log(`  usage: ${usageRow.total_value}`);
  } finally {
    await database.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
