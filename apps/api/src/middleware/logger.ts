import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../lib/logger.js";

export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      logger.info("request.completed", {
        request_id: req.requestId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        ip: req.ip,
        tenant_id: req.tenant?.tenantId ?? null,
        user_id: req.auth?.userId ?? null,
        portal_customer_id: req.portal?.customerId ?? null,
      });
    });
    next();
  };
}
