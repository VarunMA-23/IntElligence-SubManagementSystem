import { describe, it, expect } from "vitest";
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  InternalServerError,
  toRestError,
} from "../src/errors.js";

describe("AppError subclasses", () => {
  it("BadRequestError has code BAD_REQUEST and status 400", () => {
    const err = new BadRequestError("invalid input");
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.status).toBe(400);
    expect(err.message).toBe("invalid input");
  });

  it("UnauthorizedError has status 401", () => {
    expect(new UnauthorizedError().status).toBe(401);
    expect(new UnauthorizedError().code).toBe("UNAUTHORIZED");
  });

  it("ForbiddenError has status 403", () => {
    expect(new ForbiddenError().status).toBe(403);
    expect(new ForbiddenError().code).toBe("FORBIDDEN");
  });

  it("NotFoundError has status 404 and includes resource in message", () => {
    const err = new NotFoundError("Customer");
    expect(err.status).toBe(404);
    expect(err.message).toContain("Customer");
  });

  it("ConflictError has status 409", () => {
    expect(new ConflictError().status).toBe(409);
  });

  it("TooManyRequestsError has status 429", () => {
    expect(new TooManyRequestsError().status).toBe(429);
  });

  it("InternalServerError has status 500", () => {
    expect(new InternalServerError().status).toBe(500);
  });

  it("AppError carries optional details", () => {
    const details = [{ field: "email", message: "required" }];
    const err = new BadRequestError("bad", details);
    expect(err.details).toEqual(details);
  });
});

describe("toRestError", () => {
  it("converts AppError to { status, body }", () => {
    const { status, body } = toRestError(new NotFoundError("Plan"));
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain("Plan");
  });

  it("converts unknown error to 500", () => {
    const { status, body } = toRestError(new Error("boom"));
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("converts non-Error thrown value to 500", () => {
    const { status, body } = toRestError("just a string");
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("includes details in body when present", () => {
    const details = { field: "name" };
    const { body } = toRestError(new BadRequestError("oops", details));
    expect(body.details).toEqual(details);
  });

  it("omits details from body when absent", () => {
    const { body } = toRestError(new NotFoundError("Widget"));
    expect(body).not.toHaveProperty("details");
  });
});

