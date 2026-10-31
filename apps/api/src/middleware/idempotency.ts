import type { NextFunction, Request, Response } from "express";
import { ConflictError, sha256 } from "@brightloop/shared";
import { IdempotencyKey } from "@brightloop/db";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

export function idempotencyMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("idempotency-key");
    if (!key || !req.tenant) {
      next();
      return;
    }
    if (key.length > 255) {
      next(new ConflictError("Idempotency-Key is too long"));
      return;
    }
    try {
      const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
      const requestHash = sha256(stableStringify(req.body ?? {}));
      const existing = await IdempotencyKey.findOne({
        tenantId: req.tenant.tenantId,
        key,
        endpoint,
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          next(new ConflictError("Idempotency-Key was already used with a different request body"));
          return;
        }
        res.status(existing.responseStatus).json(existing.responseBody);
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (res.statusCode < 500) {
          void IdempotencyKey.create({
            tenantId: req.tenant!.tenantId,
            key,
            endpoint,
            requestHash,
            responseStatus: res.statusCode,
            responseBody: body,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }).catch(() => undefined);
        }
        return originalJson(body);
      }) as Response["json"];

      next();
    } catch (error) {
      next(error);
    }
  };
}
