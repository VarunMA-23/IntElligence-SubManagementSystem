import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ZodError, z } from "zod";
import { errorHandler, notFoundHandler } from "../../src/middleware/error-handler.js";
import {
  AppError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  TooManyRequestsError,
} from "@brightloop/shared";

function makeRes() {
  const res = {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function makeReq(overrides: Partial<Request> = {}) {
  return {
    requestId: "test-req-id",
    method: "GET",
    originalUrl: "/test",
    path: "/test",
    ...overrides,
  } as unknown as Request;
}

const logger = {
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
};

describe("errorHandler", () => {
  const handler = errorHandler(logger as any);

  it("maps AppError to its HTTP status and body", () => {
    const res = makeRes();
    handler(new NotFoundError("Widget"), makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  it("maps BadRequestError to 400", () => {
    const res = makeRes();
    handler(new BadRequestError("bad field"), makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("maps UnauthorizedError to 401", () => {
    const res = makeRes();
    handler(new UnauthorizedError(), makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("maps ForbiddenError to 403", () => {
    const res = makeRes();
    handler(new ForbiddenError(), makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("maps ConflictError to 409", () => {
    const res = makeRes();
    handler(new ConflictError(), makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("maps TooManyRequestsError to 429", () => {
    const res = makeRes();
    handler(new TooManyRequestsError(), makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("maps a ZodError to 400 BAD_REQUEST", () => {
    const schema = z.object({ name: z.string() });
    let zodErr: ZodError;
    try {
      schema.parse({});
    } catch (e) {
      zodErr = e as ZodError;
    }
    const res = makeRes();
    handler(zodErr!, makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("maps MongoDB duplicate key error (code 11000) to CONFLICT", () => {
    const res = makeRes();
    const mongoErr = { code: 11000, keyValue: { email: "test@test.com" } };
    handler(mongoErr, makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "CONFLICT" }));
  });

  it("maps malformed JSON SyntaxError to 400", () => {
    const res = makeRes();
    const syntaxErr = Object.assign(new SyntaxError("Unexpected token"), { body: true });
    handler(syntaxErr, makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("maps unknown errors to 500 INTERNAL_SERVER_ERROR", () => {
    const res = makeRes();
    handler(new Error("something exploded"), makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }));
  });

  it("logs errors at error level for 5xx", () => {
    const res = makeRes();
    handler(new Error("boom"), makeReq(), res, vi.fn() as NextFunction);
    expect(logger.error).toHaveBeenCalledWith("request.failed", expect.any(Object));
  });

  it("does NOT call res.json if headers are already sent", () => {
    const res = { ...makeRes(), headersSent: true };
    handler(new NotFoundError(), makeReq(), res as unknown as Response, vi.fn() as NextFunction);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe("notFoundHandler", () => {
  it("calls next with a NotFoundError", () => {
    const next = vi.fn() as NextFunction;
    notFoundHandler(makeReq(), makeRes(), next);
    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("NOT_FOUND");
  });

  it("includes method and path in the message", () => {
    const next = vi.fn() as NextFunction;
    notFoundHandler(makeReq({ method: "DELETE", path: "/widgets/123" }), makeRes(), next);
    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as AppError;
    expect(error.message).toContain("DELETE");
    expect(error.message).toContain("/widgets/123");
  });
});
