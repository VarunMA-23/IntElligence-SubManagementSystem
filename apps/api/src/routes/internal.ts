import { Router } from "express";
import { UnauthorizedError } from "@brightloop/shared";
import type { AppConfig } from "../config/env.js";
import { asyncHandler } from "../lib/http.js";
import { dispatchOutbox, processWebhookDeliveries } from "../services/webhook-service.js";
import { generateInvoices } from "../services/invoice-service.js";

export function internalRoutes(config: AppConfig) {
  const router = Router();
  router.use((req, _res, next) => {
    const secret = req.header("x-internal-secret");
    if (!secret || secret !== config.INTERNAL_SECRET) {
      next(new UnauthorizedError("Invalid internal secret"));
      return;
    }
    next();
  });

  router.post(
    "/billing/run",
    asyncHandler(async (req, res) => {
      const ctx = {
        tenantId: req.body?.tenant_id,
        orgId: "",
        userId: "system",
        role: "owner" as const,
        actorId: null,
      };
      if (!ctx.tenantId) {
        res.status(400).json({ code: "BAD_REQUEST", message: "tenant_id is required" });
        return;
      }
      const invoices = await generateInvoices(ctx, {
        periodStart: req.body.period_start,
        periodEnd: req.body.period_end,
        finalize: req.body.finalize ?? true,
      });
      const outbox = await dispatchOutbox(config);
      const deliveries = await processWebhookDeliveries(config);
      res.json({
        invoices: invoices.map((invoice) => ({
          id: String(invoice._id),
          number: invoice.number,
          status: invoice.status,
        })),
        outbox_dispatched: outbox,
        deliveries_processed: deliveries,
      });
    }),
  );

  router.post(
    "/outbox/process",
    asyncHandler(async (_req, res) => {
      const outbox = await dispatchOutbox(config);
      const deliveries = await processWebhookDeliveries(config);
      res.json({ outbox_dispatched: outbox, deliveries_processed: deliveries });
    }),
  );

  return router;
}
