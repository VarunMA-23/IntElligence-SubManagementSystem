import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requestIdMiddleware } from "../../src/middleware/request-id.js";

function makeReqRes(headers: Record<string, string> = {}) {
  const req = {
    header: (name: string) => headers[name.toLowerCase()] ?? undefined,
    requestId: undefined as string | undefined,
  } as unknown as Request;

  const setHeader = vi.fn();
  const res = { setHeader } as unknown as Response;
  const next: NextFunction = vi.fn();

  return { req, res, next, setHeader };
}

describe("requestIdMiddleware", () => {
  it("generates a request ID when none is provided", () => {
    const { req, res, next } = makeReqRes();
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toBeTruthy();
    expect(typeof req.requestId).toBe("string");
    expect(next).toHaveBeenCalledOnce();
  });

  it("uses incoming x-request-id when provided", () => {
    const { req, res, next } = makeReqRes({ "x-request-id": "my-custom-id" });
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toBe("my-custom-id");
  });

  it("ignores x-request-id longer than 128 chars and generates its own", () => {
    const longId = "x".repeat(129);
    const { req, res, next } = makeReqRes({ "x-request-id": longId });
    requestIdMiddleware(req, res, next);
    expect(req.requestId).not.toBe(longId);
    expect((req.requestId ?? "").length).toBeLessThanOrEqual(128);
  });

  it("sets X-Request-Id response header", () => {
    const { req, res, next, setHeader } = makeReqRes();
    requestIdMiddleware(req, res, next);
    expect(setHeader).toHaveBeenCalledWith("X-Request-Id", req.requestId);
  });

  it("generates unique IDs for consecutive requests", () => {
    const { req: req1, res: res1, next: next1 } = makeReqRes();
    const { req: req2, res: res2, next: next2 } = makeReqRes();
    requestIdMiddleware(req1, res1, next1);
    requestIdMiddleware(req2, res2, next2);
    expect(req1.requestId).not.toBe(req2.requestId);
  });
});
