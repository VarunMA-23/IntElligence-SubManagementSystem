import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/env.js";

describe("envSchema", () => {
  it("uses defaults when no overrides supplied", () => {
    const config = loadConfig();
    expect(config.NODE_ENV).toBe("test"); // NODE_ENV=test is set by vitest
    expect(config.PORT).toBe(8081);
    expect(config.RATE_LIMIT_MAX).toBe(120);
    expect(config.MAILER_TRANSPORT).toBe("console");
  });

  it("parses PORT as a number", () => {
    const config = loadConfig({ PORT: "9000" });
    expect(config.PORT).toBe(9000);
  });

  it("rejects PORT below 1", () => {
    expect(() => loadConfig({ PORT: "0" })).toThrow("Invalid environment configuration");
  });

  it("rejects PORT above 65535", () => {
    expect(() => loadConfig({ PORT: "99999" })).toThrow("Invalid environment configuration");
  });

  it("parses boolean USE_MEMORY_DB from string 'true'", () => {
    const config = loadConfig({ USE_MEMORY_DB: "true" });
    expect(config.USE_MEMORY_DB).toBe(true);
  });

  it("parses boolean USE_MEMORY_DB from string '1'", () => {
    const config = loadConfig({ USE_MEMORY_DB: "1" });
    expect(config.USE_MEMORY_DB).toBe(true);
  });

  it("defaults USE_MEMORY_DB to false", () => {
    const config = loadConfig({ USE_MEMORY_DB: undefined });
    expect(config.USE_MEMORY_DB).toBe(false);
  });

  it("rejects JWT_SECRET shorter than 8 chars", () => {
    expect(() => loadConfig({ JWT_SECRET: "short" })).toThrow("Invalid environment configuration");
  });

  it("rejects invalid LOG_LEVEL", () => {
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow("Invalid environment configuration");
  });

  it("rejects invalid NODE_ENV", () => {
    expect(() => loadConfig({ NODE_ENV: "staging" })).toThrow("Invalid environment configuration");
  });

  it("sets ALLOW_LOCAL_WEBHOOKS=true automatically in test mode", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(config.ALLOW_LOCAL_WEBHOOKS).toBe(true);
  });

  it("accepts all valid LOG_LEVEL values", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      const config = loadConfig({ LOG_LEVEL: level });
      expect(config.LOG_LEVEL).toBe(level);
    }
  });
});

