export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Invalid request", details?: unknown) {
    super("BAD_REQUEST", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super("FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super("NOT_FOUND", `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message = "The resource is in a conflicting state") {
    super("CONFLICT", message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests") {
    super("TOO_MANY_REQUESTS", message);
  }
}

export class InternalServerError extends AppError {
  constructor(message = "An unexpected error occurred") {
    super("INTERNAL_SERVER_ERROR", message);
  }
}

export interface RestErrorResponse {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export function toRestError(error: unknown): { status: number; body: RestErrorResponse } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    };
  }
  return {
    status: 500,
    body: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
  };
}
