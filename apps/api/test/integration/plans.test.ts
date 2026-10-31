import { describe, it, expect } from "vitest";
import request from "supertest";
import { InvoicingEntity } from "@brightloop/db";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";

const config = loadConfig({ NODE_ENV: "test", USE_MEMORY_DB: "true", LOG_LEVEL: "error" });
const app = createApp(config);
const BASE_AUTH = "/api/v1/auth";
let _counter = 0;

async function createTenantSession() {
  const n = ++_counter;
  const email = `plan-${n}@test.com`;
  const reg = await request(app).post(`${BASE_AUTH}/register`).send({ email, password: "Password123!", name: "Tester" });
  await request(app).post(`${BASE_AUTH}/verify-email`).send({ token: reg.body.verification_token_hint });
  const login = await request(app).post(`${BASE_AUTH}/login`).send({ email, password: "Password123!" });
  const org = await request(app)
    .post(`${BASE_AUTH}/organizations`)
    .set("Authorization", `Bearer ${login.body.access_token}`)
    .send({ name: `Org ${n}`, slug: `plan-org-${n}` });
  await InvoicingEntity.create({
    tenantId: org.body.tenant.id,
    name: "Default Entity",
    defaultCurrency: "USD",
    isDefault: true,
  });
  return { token: org.body.access_token, tenantId: org.body.tenant.id };
}

/** Create a product family + product, return familyId and productId */
async function seedCatalog(token: string) {
  const fam = await request(app)
    .post("/api/v1/product-families")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Platform", alias: `pf-${Date.now()}` });
  expect(fam.status).toBe(201);
  const prod = await request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${token}`)
    .send({ family_id: fam.body.id, name: "Access", alias: `pa-${Date.now()}`, fee_type: "RATE" });
  expect(prod.status).toBe(201);
  return { familyId: fam.body.id, productId: prod.body.id };
}

function planPayload(familyId: string, productId: string, alias: string) {
  return {
    name: "Starter",
    alias,
    product_family_id: familyId,
    currency: "USD",
    billing_period: "MONTHLY",
    billing_type: "ADVANCE",
    net_terms: 30,
    trial_days: 0,
    components: [
      {
        product_id: productId,
        name: "Platform Fee",
        fee_type: "RATE",
        billing_period: "MONTHLY",
        billing_type: "ADVANCE",
        pricing: { type: "FLAT", rate: "49.00" },
        order: 0,
      },
    ],
  };
}

describe("Plans API", () => {
  it("lists empty plans for a new tenant", async () => {
    const { token } = await createTenantSession();
    const res = await request(app).get("/api/v1/plans").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBe(0);
  });

  it("creates a plan and returns 201 in DRAFT status", async () => {
    const { token } = await createTenantSession();
    const { familyId, productId } = await seedCatalog(token);
    const res = await request(app)
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${token}`)
      .send(planPayload(familyId, productId, `plan-a-${Date.now()}`));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.currency).toBe("USD");
    expect(res.body.id).toBeTruthy();
  });

  it("rejects a plan with no components", async () => {
    const { token } = await createTenantSession();
    const { familyId } = await seedCatalog(token);
    const res = await request(app)
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Empty",
        alias: "empty-plan",
        product_family_id: familyId,
        currency: "USD",
        billing_period: "MONTHLY",
        billing_type: "ADVANCE",
        components: [],
      });
    expect(res.status).toBe(400);
  });

  it("fetches a plan by id", async () => {
    const { token } = await createTenantSession();
    const { familyId, productId } = await seedCatalog(token);
    const create = await request(app)
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${token}`)
      .send(planPayload(familyId, productId, `plan-get-${Date.now()}`));
    expect(create.status).toBe(201);
    const res = await request(app).get(`/api/v1/plans/${create.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(create.body.id);
  });

  it("publishes a draft plan â†’ status becomes ACTIVE", async () => {
    const { token } = await createTenantSession();
    const { familyId, productId } = await seedCatalog(token);
    const create = await request(app)
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${token}`)
      .send(planPayload(familyId, productId, `plan-pub-${Date.now()}`));
    expect(create.status).toBe(201);
    const pub = await request(app)
      .post(`/api/v1/plans/${create.body.id}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(pub.status).toBe(200);
    // publish returns the new PlanVersion object
    expect(pub.body.id).toBeTruthy();
    expect(pub.body.version).toBe(1);
    expect(pub.body.published_at).toBeTruthy();
    // Now fetch the plan to confirm it moved to ACTIVE
    const planRes = await request(app).get(`/api/v1/plans/${create.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(planRes.status).toBe(200);
    expect(planRes.body.status).toBe("ACTIVE");
    expect(planRes.body.current_version_id).toBeTruthy();
  });

  it("returns 404 for a non-existent plan", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .get("/api/v1/plans/00000000-0000-7000-8000-000000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("rejects duplicate plan alias with 409", async () => {
    const { token } = await createTenantSession();
    const { familyId, productId } = await seedCatalog(token);
    const alias = `dup-plan-${Date.now()}`;
    await request(app).post("/api/v1/plans").set("Authorization", `Bearer ${token}`).send(planPayload(familyId, productId, alias));
    const res = await request(app).post("/api/v1/plans").set("Authorization", `Bearer ${token}`).send(planPayload(familyId, productId, alias));
    expect(res.status).toBe(409);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/plans");
    expect(res.status).toBe(401);
  });
});