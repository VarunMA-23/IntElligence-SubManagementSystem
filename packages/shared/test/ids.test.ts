import { describe, it, expect } from "vitest";
import { newId, newOpaqueToken, sha256, randomSecret, slugify, nextNumber } from "../src/ids.js";

describe("newId", () => {
  it("returns a non-empty string", () => {
    expect(typeof newId()).toBe("string");
    expect(newId().length).toBeGreaterThan(0);
  });

  it("generates unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });

  it("is a valid UUID v7 format", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe("newOpaqueToken", () => {
  it("defaults to 32 bytes of base64url", () => {
    const token = newOpaqueToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  it("generates unique tokens", () => {
    expect(newOpaqueToken()).not.toBe(newOpaqueToken());
  });

  it("respects the bytes parameter", () => {
    const short = newOpaqueToken(8);
    const long = newOpaqueToken(64);
    expect(short.length).toBeLessThan(long.length);
  });
});

describe("sha256", () => {
  it("returns a 64-character hex string", () => {
    const hash = sha256("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256("hello")).not.toBe(sha256("world"));
  });

  it("hashes empty string without error", () => {
    expect(sha256("")).toHaveLength(64);
  });
});

describe("randomSecret", () => {
  it("returns a hex string of the expected length", () => {
    const secret = randomSecret(16);
    expect(secret).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(secret).toMatch(/^[0-9a-f]+$/);
  });
});

describe("slugify", () => {
  it("lowercases and trims", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("replaces spaces and special chars with hyphens", () => {
    expect(slugify("Acme Corp. (US)")).toBe("acme-corp-us");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("-hello-")).toBe("hello");
  });

  it("truncates to 48 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(48);
  });

  it("falls back to 'workspace' for empty/all-special input", () => {
    expect(slugify("!!!")).toBe("workspace");
    expect(slugify("")).toBe("workspace");
  });
});

describe("nextNumber", () => {
  it("formats number with prefix, year, and zero-padded sequence", () => {
    expect(nextNumber("INV", 2024, 1)).toBe("INV-2024-000001");
    expect(nextNumber("CN", 2024, 99)).toBe("CN-2024-000099");
    expect(nextNumber("INV", 2025, 123456)).toBe("INV-2025-123456");
  });
});
