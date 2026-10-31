import cors from "cors";
import helmet from "helmet";
import type { RequestHandler } from "express";
import type { AppConfig } from "../config/env.js";

export function securityMiddleware(config: AppConfig): RequestHandler[] {
  const origins = config.WEB_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [
    helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }) as RequestHandler,
    cors({
      origin(origin, callback) {
        if (!origin || origins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
      allowedHeaders: [
        "authorization",
        "content-type",
        "idempotency-key",
        "x-request-id",
        "x-internal-secret",
        "x-portal-token",
      ],
      exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
    }),
  ];
}
