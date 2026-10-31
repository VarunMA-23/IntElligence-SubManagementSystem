import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";

const config = loadConfig({ NODE_ENV: "test", USE_MEMORY_DB: "true", LOG_LEVEL: "error" });
const app = createApp(config);

describe("GET /health", () => {
  it("returns 200 with status field", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("service");
  });

  it("includes a timestamp in ISO format", async () => {
    const res = await request(app).get("/health");
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes a database field", async () => {
    const res = await request(app).get("/health");
    expect(res.body).toHaveProperty("database");
  });

  it("returns X-Request-Id response header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("propagates a provided X-Request-Id", async () => {
    const id = "test-request-id-001";
    const res = await request(app).get("/health").set("X-Request-Id", id);
    expect(res.headers["x-request-id"]).toBe(id);
  });
});

describe("Unknown non-API routes (no auth middleware)", () => {
  it("returns 404 NOT_FOUND for a top-level unknown path", async () => {
    const res = await request(app).get("/nonexistent-route-xyz");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns 404 for unknown path under /api", async () => {
    const res = await request(app).get("/api/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("Protected API routes require authentication", () => {
  it("returns 401 for a protected route with no token", async () => {
    // /api/v1/customers is behind authMiddleware — no token → 401 not 404
    const res = await request(app).get("/api/v1/customers");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for an unknown sub-path with no token", async () => {
    const res = await request(app).get("/api/v1/customers/x/y/z/not-real");
    expect(res.status).toBe(401);
  });
});

describe("Malformed JSON body", () => {
  it("returns 400 for a malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{bad json}");
    expect(res.status).toBe(400);
  });
});
