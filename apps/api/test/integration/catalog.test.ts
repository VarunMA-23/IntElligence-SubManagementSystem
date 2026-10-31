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
  const email = `catalog-${n}@test.com`;
  const reg = await request(app)
    .post(`${BASE_AUTH}/register`)
    .send({ email, password: "Password123!", name: "Tester" });
  await request(app)
    .post(`${BASE_AUTH}/verify-email`)
    .send({ token: reg.body.verification_token_hint });
  const login = await request(app)
    .post(`${BASE_AUTH}/login`)
    .send({ email, password: "Password123!" });
  const org = await request(app)
    .post(`${BASE_AUTH}/organizations`)
    .set("Authorization", `Bearer ${login.body.access_token}`)
    .send({ name: `Org ${n}`, slug: `catalog-org-${n}` });
  await InvoicingEntity.create({
    tenantId: org.body.tenant.id,
    name: "Default Entity",
    defaultCurrency: "USD",
    isDefault: true,
  });
  return { token: org.body.access_token, tenantId: org.body.tenant.id };
}

describe("Product Families", () => {
  it("lists empty families initially", async () => {
    const { token } = await createTenantSession();
    const res = await request(app).get("/api/v1/product-families").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("creates a product family", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post("/api/v1/product-families")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Platform", alias: "platform" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Platform");
    expect(res.body.alias).toBe("platform");
    expect(res.body.id).toBeTruthy();
  });

  it("rejects duplicate family alias with 409", async () => {
    const { token } = await createTenantSession();
    await request(app).post("/api/v1/product-families").set("Authorization", `Bearer ${token}`).send({ name: "Dup", alias: "dup-fam" });
    const res = await request(app).post("/api/v1/product-families").set("Authorization", `Bearer ${token}`).send({ name: "Dup2", alias: "dup-fam" });
    expect(res.status).toBe(409);
  });

  it("updates a product family name", async () => {
    const { token } = await createTenantSession();
    const create = await request(app).post("/api/v1/product-families").set("Authorization", `Bearer ${token}`).send({ name: "Old Name", alias: "upd-fam" });
    const res = await request(app).patch(`/api/v1/product-families/${create.body.id}`).set("Authorization", `Bearer ${token}`).send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");
  });

  it("requires auth to access product families", async () => {
    const res = await request(app).get("/api/v1/product-families");
    expect(res.status).toBe(401);
  });
});

describe("Products", () => {
  it("creates a product under a family", async () => {
    const { token } = await createTenantSession();
    const fam = await request(app).post("/api/v1/product-families").set("Authorization", `Bearer ${token}`).send({ name: "Platform", alias: "pl-fam" });
    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ family_id: fam.body.id, name: "API Access", alias: "api-access", fee_type: "RATE" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("API Access");
    expect(res.body.fee_type).toBe("RATE");
  });

  it("rejects product with invalid fee_type", async () => {
    const { token } = await createTenantSession();
    const fam = await request(app).post("/api/v1/product-families").set("Authorization", `Bearer ${token}`).send({ name: "Fam", alias: "fam-inv" });
    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ family_id: fam.body.id, name: "Bad", alias: "bad-prod", fee_type: "INVALID" });
    expect(res.status).toBe(400);
  });

  it("lists products", async () => {
    const { token } = await createTenantSession();
    const fam = await request(app).post("/api/v1/product-families").set("Authorization", `Bearer ${token}`).send({ name: "Fam", alias: "list-fam" });
    await request(app).post("/api/v1/products").set("Authorization", `Bearer ${token}`).send({ family_id: fam.body.id, name: "P1", alias: "p1-list", fee_type: "RATE" });
    await request(app).post("/api/v1/products").set("Authorization", `Bearer ${token}`).send({ family_id: fam.body.id, name: "P2", alias: "p2-list", fee_type: "USAGE" });
    const res = await request(app).get("/api/v1/products").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
  });
});

describe("Billable Metrics", () => {
  it("creates a COUNT metric without a field", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post("/api/v1/metrics")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "API Calls", code: "api_calls", aggregation: "COUNT" });
    expect(res.status).toBe(201);
    expect(res.body.aggregation).toBe("COUNT");
    expect(res.body.code).toBe("api_calls");
  });

  it("creates a SUM metric with a field", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post("/api/v1/metrics")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Data GB", code: "data_gb", aggregation: "SUM", field: "bytes" });
    expect(res.status).toBe(201);
    expect(res.body.field).toBe("bytes");
  });

  it("rejects non-COUNT metric without field", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post("/api/v1/metrics")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Field", code: "no_field", aggregation: "SUM" });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate metric code with 409", async () => {
    const { token } = await createTenantSession();
    await request(app).post("/api/v1/metrics").set("Authorization", `Bearer ${token}`).send({ name: "M1", code: "dup_metric", aggregation: "COUNT" });
    const res = await request(app).post("/api/v1/metrics").set("Authorization", `Bearer ${token}`).send({ name: "M2", code: "dup_metric", aggregation: "COUNT" });
    expect(res.status).toBe(409);
  });

  it("lists all metrics", async () => {
    const { token } = await createTenantSession();
    await request(app).post("/api/v1/metrics").set("Authorization", `Bearer ${token}`).send({ name: "M1", code: "met_a", aggregation: "COUNT" });
    await request(app).post("/api/v1/metrics").set("Authorization", `Bearer ${token}`).send({ name: "M2", code: "met_b", aggregation: "COUNT" });
    const res = await request(app).get("/api/v1/metrics").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
  });
});

describe("Features", () => {
  it("creates a BOOLEAN feature", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post("/api/v1/features")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "SSO", code: "sso", feature_type: "BOOLEAN" });
    expect(res.status).toBe(201);
    expect(res.body.feature_type).toBe("BOOLEAN");
    expect(res.body.code).toBe("sso");
  });

  it("creates a METERED feature", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post("/api/v1/features")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "API Requests", code: "api_requests", feature_type: "METERED" });
    expect(res.status).toBe(201);
    expect(res.body.feature_type).toBe("METERED");
  });

  it("rejects invalid feature_type", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post("/api/v1/features")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bad", code: "bad_ft", feature_type: "INVALID" });
    expect(res.status).toBe(400);
  });

  it("lists features", async () => {
    const { token } = await createTenantSession();
    await request(app).post("/api/v1/features").set("Authorization", `Bearer ${token}`).send({ name: "F1", code: "f1_code", feature_type: "BOOLEAN" });
    const res = await request(app).get("/api/v1/features").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /catalog (combined catalog)", () => {
  it("returns all catalog entities in one response", async () => {
    const { token } = await createTenantSession();
    await request(app).post("/api/v1/product-families").set("Authorization", `Bearer ${token}`).send({ name: "Fam", alias: "cat-fam" });
    const res = await request(app).get("/api/v1/catalog").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.product_families)).toBe(true);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(Array.isArray(res.body.features)).toBe(true);
    expect(Array.isArray(res.body.metrics)).toBe(true);
  });
});