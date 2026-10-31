import { Router } from "express";
import {
  BadRequestError,
  ForbiddenError,
  ingestEventsSchema,
  summaryQuerySchema,
  usageQuerySchema,
} from "@brightloop/shared";
import { asyncHandler } from "../lib/http.js";
import { resolveCustomer } from "../lib/domain.js";
import { requireMinRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { ingestEvents, usageForCustomer, usageForTenant } from "../services/metering-service.js";

function periodFromQuery(query: any) {
  const now = new Date();
  const start = query.period_start
    ? new Date(query.period_start)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = query.period_end
    ? new Date(query.period_end)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new BadRequestError("invalid usage period");
  }
  return { start, end };
}

export function usageRoutes() {
  const router = Router();

  router.post(
    "/events",
    requireMinRole("member"),
    validate({ body: ingestEventsSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const result = await ingestEvents(req.tenant, req.body);
      res.status(202).json(result);
    }),
  );

  router.get(
    "/usage",
    validate({ query: summaryQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const { start, end } = periodFromQuery(req.query);
      res.json({
        data: await usageForTenant(req.tenant.tenantId, start, end),
        period_start: start.toISOString(),
        period_end: end.toISOString(),
      });
    }),
  );

  router.get(
    "/customers/:idOrAlias/usage",
    validate({ query: usageQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const customer = await resolveCustomer(req.tenant.tenantId, req.params.idOrAlias);
      const { start, end } = periodFromQuery(req.query);
      res.json({
        data: await usageForCustomer(
          req.tenant.tenantId,
          String(customer._id),
          start,
          end,
          (req.query as any).metric_code,
        ),
        customer_id: String(customer._id),
        period_start: start.toISOString(),
        period_end: end.toISOString(),
      });
    }),
  );

  return router;
}
