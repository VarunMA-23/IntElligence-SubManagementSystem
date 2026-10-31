import { describe, it, expect } from "vitest";
import request from "supertest";
import { InvoicingEntity } from "@brightloop/db";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";

const config = loadConfig({ NODE_ENV: "test", USE_MEMORY_DB: "true", LOG_LEVEL: "error" });
const app = createApp(config);

const BASE_AUTH = "/api/v1/auth";
const BASE_CUST = "/api/v1/customers";

let _counter = 0;

/**
 * Creates a unique user, verifies email, creates org, seeds an invoicing entity,
 * and returns both the bearer token and tenantId.
 */
async function createTenantSession(): Promise<{
  token: string;
  tenantId: string;
  orgId: string;
}> {
  const n = ++_counter;
  const email = `cust-${n}@test.com`;

  const reg = await request(app)
    .post(`${BASE_AUTH}/register`)
    .send({ email, password: "Password123!", name: "Tester" });
  expect(reg.status).toBe(201);

  await request(app)
    .post(`${BASE_AUTH}/verify-email`)
    .send({ token: reg.body.verification_token_hint });

  const login = await request(app)
    .post(`${BASE_AUTH}/login`)
    .send({ email, password: "Password123!" });
  expect(login.status).toBe(200);

  const org = await request(app)
    .post(`${BASE_AUTH}/organizations`)
    .set("Authorization", `Bearer ${login.body.access_token}`)
    .send({ name: `Org ${n}`, slug: `org-${n}` });
  expect(org.status).toBe(201);

  const tenantId: string = org.body.tenant.id;

  // Seed the default invoicing entity that customer creation requires
  await InvoicingEntity.create({
    tenantId,
    name: "Default Entity",
    defaultCurrency: "USD",
    isDefault: true,
  });

  return { token: org.body.access_token, tenantId, orgId: org.body.organization.id };
}

function validPayload(alias: string) {
  return {
    alias,
    name: "Alice Corp",
    invoicing_emails: ["billing@alice.com"],
    currency: "USD",
  };
}

// Each test gets a fresh tenant because beforeEach in setup.ts clears all collections
describe("Customers API", () => {
  it("requires authentication — returns 401", async () => {
    const res = await request(app).get(BASE_CUST);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("lists customers (empty list after fresh setup)", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .get(BASE_CUST)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBe(0);
  });

  it("creates a customer and returns 201", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post(BASE_CUST)
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload("cust-0001"));
    expect(res.status).toBe(201);
    expect(res.body.alias).toBe("cust-0001");
    expect(res.body.name).toBe("Alice Corp");
    expect(res.body.id).toBeTruthy();
    expect(res.body.currency).toBe("USD");
  });

  it("fetches a customer by alias", async () => {
    const { token } = await createTenantSession();
    await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("cust-0002"));
    const res = await request(app).get(`${BASE_CUST}/cust-0002`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.alias).toBe("cust-0002");
  });

  it("fetches a customer by id", async () => {
    const { token } = await createTenantSession();
    const create = await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("cust-0003"));
    expect(create.status).toBe(201);
    const id: string = create.body.id;
    const res = await request(app).get(`${BASE_CUST}/${id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it("returns 404 for a non-existent customer", async () => {
    const { token } = await createTenantSession();
    const res = await request(app).get(`${BASE_CUST}/nonexistent-alias-xyz`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("updates a customer name", async () => {
    const { token } = await createTenantSession();
    await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("cust-0004"));
    const res = await request(app)
      .patch(`${BASE_CUST}/cust-0004`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Name" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
  });

  it("rejects duplicate alias with 409", async () => {
    const { token } = await createTenantSession();
    await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("cust-0005"));
    const res = await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("cust-0005"));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("archives a customer via DELETE", async () => {
    const { token } = await createTenantSession();
    await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("cust-0006"));
    const res = await request(app).delete(`${BASE_CUST}/cust-0006`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.archived_at).toBeTruthy();
    expect(res.body.archived).toBe(true);
  });

  it("returns 400 for missing required invoicing_emails", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post(BASE_CUST)
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "cust-bad", name: "Bad Corp", currency: "USD" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("returns 400 for missing alias", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post(BASE_CUST)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Alias Corp", invoicing_emails: ["x@x.com"], currency: "USD" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid alias format (uppercase, spaces)", async () => {
    const { token } = await createTenantSession();
    const res = await request(app)
      .post(BASE_CUST)
      .set("Authorization", `Bearer ${token}`)
      .send({ alias: "INVALID ALIAS!", name: "Corp", invoicing_emails: ["x@x.com"], currency: "USD" });
    expect(res.status).toBe(400);
  });

  it("lists multiple customers and shows correct total", async () => {
    const { token } = await createTenantSession();
    await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("cust-0007"));
    await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("cust-0008"));
    const res = await request(app).get(BASE_CUST).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data).toHaveLength(2);
  });

  it("returns customer overview with subscriptions list", async () => {
    const { token } = await createTenantSession();
    const create = await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("cust-0009"));
    expect(create.status).toBe(201);
    const id: string = create.body.id;
    const res = await request(app).get(`${BASE_CUST}/${id}/overview`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.customer).toBeDefined();
    expect(Array.isArray(res.body.subscriptions)).toBe(true);
  });

  it("supports search query param", async () => {
    const { token } = await createTenantSession();
    await request(app).post(BASE_CUST).set("Authorization", `Bearer ${token}`).send(validPayload("search-target"));
    const res = await request(app)
      .get(`${BASE_CUST}?search=Alice`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

