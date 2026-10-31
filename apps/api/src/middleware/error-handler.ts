import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, BadRequestError, NotFoundError, toRestError } from "@brightloop/shared";
import type { Logger } from "../lib/logger.js";

interface MongoDuplicateError {
  code?: number;
  keyValue?: Record<string, unknown>;
}

export function errorHandler(logger: Logger) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    let normalized: unknown = error;

    if (error instanceof ZodError) {
      const first = error.issues[0];
      const path = first?.path.join(".");
      normalized = new BadRequestError(path ? `field '${path}' ${first?.message}` : error.message, error.issues);
    } else if (error && typeof error === "object" && (error as MongoDuplicateError).code === 11000) {
      const duplicate = error as MongoDuplicateError;
      const field = Object.keys(duplicate.keyValue ?? {})[1] ?? Object.keys(duplicate.keyValue ?? {})[0] ?? "value";
      normalized = new AppError("CONFLICT", `${field} already exists`);
    } else if (error instanceof SyntaxError && "body" in (error as object)) {
      normalized = new BadRequestError("malformed JSON body");
    }

    const { status, body } = toRestError(normalized);
    if (status >= 500) {
      logger.error("request.failed", {
        request_id: req.requestId,
        method: req.method,
        path: req.originalUrl,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
      });
    }
    if (res.headersSent) return;
    res.status(status).json(body);
  };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
}
