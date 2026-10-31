import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";

const config = loadConfig({ NODE_ENV: "test", USE_MEMORY_DB: "true", LOG_LEVEL: "error" });
const app = createApp(config);

// Helpers
const BASE = "/api/v1/auth";

async function register(email: string, password = "Password123!", name = "Test User") {
  return request(app).post(`${BASE}/register`).send({ email, password, name });
}

async function registerAndVerify(email: string, password = "Password123!") {
  const reg = await register(email, password);
  expect(reg.status).toBe(201);
  const token: string = reg.body.verification_token_hint;
  const verifyRes = await request(app).post(`${BASE}/verify-email`).send({ token });
  expect(verifyRes.status).toBe(200);
  return { email, password, userId: reg.body.user.id };
}

async function login(email: string, password = "Password123!") {
  return request(app).post(`${BASE}/login`).send({ email, password });
}

describe("POST /auth/register", () => {
  it("creates a new user and returns 201", async () => {
    const res = await register("new@example.com");
    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe("new@example.com");
    expect(res.body.verification_required).toBe(true);
  });

  it("returns the verification_token_hint in test/console mode", async () => {
    const res = await register("hint@example.com");
    expect(res.status).toBe(201);
    expect(typeof res.body.verification_token_hint).toBe("string");
  });

  it("rejects duplicate email with 409 CONFLICT", async () => {
    await register("dup@example.com");
    const res2 = await register("dup@example.com");
    expect(res2.status).toBe(409);
    expect(res2.body.code).toBe("CONFLICT");
  });

  it("rejects missing email with 400", async () => {
    const res = await request(app).post(`${BASE}/register`).send({ password: "abc123456", name: "Test" });
    expect(res.status).toBe(400);
  });

  it("rejects missing name with 400", async () => {
    const res = await request(app).post(`${BASE}/register`).send({ email: "noname@example.com", password: "abc123456" });
    expect(res.status).toBe(400);
  });

  it("stores email in lowercase", async () => {
    const res = await register("UPPER@EXAMPLE.COM");
    expect(res.body.user.email).toBe("upper@example.com");
  });
});

describe("POST /auth/verify-email", () => {
  it("verifies email with a valid token", async () => {
    const reg = await register("verify@example.com");
    const token: string = reg.body.verification_token_hint;
    const res = await request(app).post(`${BASE}/verify-email`).send({ token });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it("returns 404 for an invalid token", async () => {
    const res = await request(app).post(`${BASE}/verify-email`).send({ token: "invalid-token" });
    expect(res.status).toBe(404);
  });
});

describe("POST /auth/login", () => {
  it("returns tokens and user after successful login", async () => {
    await registerAndVerify("login@example.com");
    const res = await login("login@example.com");
    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
    expect(typeof res.body.refresh_token).toBe("string");
    expect(res.body.expires_in).toBe(900);
  });

  it("rejects wrong password with 401", async () => {
    await registerAndVerify("wrongpw@example.com");
    const res = await login("wrongpw@example.com", "WrongPassword99!");
    expect(res.status).toBe(401);
  });

  it("rejects unverified email with 403", async () => {
    await register("unverified@example.com");
    const res = await login("unverified@example.com");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("rejects unknown email with 401", async () => {
    const res = await login("ghost@example.com");
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing credentials", async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: "only@example.com" });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/forgot-password", () => {
  it("returns submitted:true for any email (no user enumeration)", async () => {
    const res = await request(app).post(`${BASE}/forgot-password`).send({ email: "anyone@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(true);
  });
});

describe("POST /auth/refresh", () => {
  it("exchanges a valid refresh token for new tokens", async () => {
    await registerAndVerify("refresh@example.com");
    await createOrgForUser("refresh@example.com");
    const loginRes = await login("refresh@example.com");
    const refreshToken: string = loginRes.body.refresh_token;

    const res = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refresh_token: refreshToken });
    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
    expect(typeof res.body.refresh_token).toBe("string");
    expect(res.body.refresh_token).not.toBe(refreshToken);
  });

  it("rejects an invalid refresh token with 401", async () => {
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refresh_token: "garbage-token" });
    expect(res.status).toBe(401);
  });
});

describe("GET /auth/me", () => {
  it("returns current user when authenticated", async () => {
    await registerAndVerify("me@example.com");
    await createOrgForUser("me@example.com");
    const loginRes = await login("me@example.com");
    const token: string = loginRes.body.access_token;

    const res = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("me@example.com");
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get(`${BASE}/me`);
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/organizations", () => {
  it("creates an org+tenant for a verified user", async () => {
    await registerAndVerify("orgcreate@example.com");
    const loginRes = await login("orgcreate@example.com");
    const token: string = loginRes.body.access_token;

    const res = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Corp", slug: "acme-corp" });
    expect(res.status).toBe(201);
    expect(res.body.organization.name).toBe("Acme Corp");
    expect(typeof res.body.access_token).toBe("string");
  });

  it("returns 403 for unverified user", async () => {
    await register("unverifiedorg@example.com");
    const loginRes = await request(app)
      .post(`${BASE}/login`)
      .send({ email: "unverifiedorg@example.com", password: "Password123!" });
    // login itself requires verification, so we expect 403 from login
    expect(loginRes.status).toBe(403);
  });
});

// Helper: create an org so refresh/me work properly
async function createOrgForUser(email: string) {
  const loginRes = await login(email);
  if (loginRes.status !== 200) return null;
  const token: string = loginRes.body.access_token;
  const slug = email.split("@")[0]!.replace(/[^a-z0-9]/gi, "-");
  const res = await request(app)
    .post(`${BASE}/organizations`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Test Org", slug });
  return res.status === 201 ? res.body : null;
}
