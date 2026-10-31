import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createRateLimiter } from "../../src/middleware/rate-limit.js";

function makeReqRes(ip = "127.0.0.1") {
  const res = {
    setHeader: vi.fn(),
  } as unknown as Response;
  const req = { ip } as unknown as Request;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });
    for (let i = 0; i < 5; i++) {
      const { req, res, next } = makeReqRes();
      limiter(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      // next should NOT have been called with an error
      const callArg = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(callArg).toBeUndefined();
    }
  });

  it("blocks the (max+1)th request with 429", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    const ip = "1.2.3.4";
    for (let i = 0; i < 3; i++) {
      const { req, res, next } = makeReqRes(ip);
      limiter(req, res, next);
    }
    const { req, res, next } = makeReqRes(ip);
    limiter(req, res, next);
    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { code?: string };
    expect(error).toBeTruthy();
    expect(error?.code).toBe("TOO_MANY_REQUESTS");
  });

  it("sets RateLimit-* response headers", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });
    const { req, res, next } = makeReqRes("5.5.5.5");
    limiter(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith("RateLimit-Limit", "10");
    expect(res.setHeader).toHaveBeenCalledWith("RateLimit-Remaining", "9");
  });

  it("sets Retry-After header when rate limited", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    const ip = "2.3.4.5";
    const { req: r1, res: res1, next: n1 } = makeReqRes(ip);
    limiter(r1, res1, n1);
    const { req: r2, res: res2, next: n2 } = makeReqRes(ip);
    limiter(r2, res2, n2);
    expect(res2.setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });

  it("uses a custom key function when provided", () => {
    const keyFn = vi.fn().mockReturnValue("custom-key");
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, key: keyFn });
    const { req, res, next } = makeReqRes();
    limiter(req, res, next);
    expect(keyFn).toHaveBeenCalledWith(req);
  });

  it("resets the bucket after the window expires", async () => {
    const limiter = createRateLimiter({ windowMs: 50, max: 1 });
    const ip = "3.3.3.3";
    {
      const { req, res, next } = makeReqRes(ip);
      limiter(req, res, next);
    }
    await new Promise((r) => setTimeout(r, 60));
    const { req, res, next } = makeReqRes(ip);
    limiter(req, res, next);
    const callArg = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(callArg).toBeUndefined();
  });
});

