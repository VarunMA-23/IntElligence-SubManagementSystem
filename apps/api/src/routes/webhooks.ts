import { Router } from "express";
import {
  ForbiddenError,
  NotFoundError,
  batchJobFailureQuerySchema,
  batchJobListQuerySchema,
  createBatchJobSchema,
  createWebhookSchema,
  updateWebhookSchema,
  webhookListQuerySchema,
} from "@brightloop/shared";
import { DeadLetterEvent } from "@brightloop/db";
import type { AppConfig } from "../config/env.js";
import { asyncHandler, pageMeta } from "../lib/http.js";
import {
  serializeBatchJob,
  serializeDelivery,
  serializeWebhook,
} from "../lib/serializers.js";
import { requireMinRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createWebhook,
  deleteWebhook,
  dispatchOutbox,
  listDeliveries,
  listWebhooks,
  processWebhookDeliveries,
  replayDeadLetter,
  updateWebhook,
  webhookDeliveriesForTenant,
} from "../services/webhook-service.js";
import {
  batchJobFailures,
  createBatchJob,
  getBatchJob,
  listBatchJobs,
} from "../services/batch-service.js";

export function webhookRoutes(config: AppConfig) {
  const router = Router();

  router.get(
    "/webhooks",
    validate({ query: webhookListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const webhooks = await listWebhooks(req.tenant.tenantId);
      res.json({ data: webhooks.map(serializeWebhook) });
    }),
  );

  router.post(
    "/webhooks",
    requireMinRole("admin"),
    validate({ body: createWebhookSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const { webhook, secret } = await createWebhook(req.tenant, config, req.body);
      res.status(201).json({ ...serializeWebhook(webhook), secret });
    }),
  );

  router.patch(
    "/webhooks/:id",
    requireMinRole("admin"),
    validate({ body: updateWebhookSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeWebhook(await updateWebhook(req.tenant, config, req.params.id, req.body)));
    }),
  );

  router.delete(
    "/webhooks/:id",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      await deleteWebhook(req.tenant, req.params.id);
      res.status(204).send();
    }),
  );

  router.get(
    "/webhooks/:id/deliveries",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const page = Math.max(0, Number(req.query.page ?? 0));
      const perPage = Math.min(100, Math.max(1, Number(req.query.per_page ?? 20)));
      const result = await listDeliveries(req.tenant.tenantId, req.params.id, page, perPage);
      res.json({
        data: result.data.map(serializeDelivery),
        meta: pageMeta(page, perPage, result.total),
      });
    }),
  );

  router.get(
    "/webhook-deliveries",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const page = Math.max(0, Number(req.query.page ?? 0));
      const perPage = Math.min(100, Math.max(1, Number(req.query.per_page ?? 20)));
      const result = await webhookDeliveriesForTenant(req.tenant.tenantId, page, perPage);
      res.json({
        data: result.data.map(serializeDelivery),
        meta: pageMeta(page, perPage, result.total),
      });
    }),
  );

  router.post(
    "/webhooks/process",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      const outbox = await dispatchOutbox(config);
      const deliveries = await processWebhookDeliveries(config);
      res.json({ outbox_dispatched: outbox, deliveries_processed: deliveries });
    }),
  );

  router.get(
    "/dead-letters",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const data = await DeadLetterEvent.find({ tenantId: req.tenant.tenantId }).sort({ failedAt: -1 }).limit(100);
      res.json({
        data: data.map((event) => ({
          id: String(event._id),
          source: event.source,
          payload: event.payload,
          error: event.error,
          failed_at: event.failedAt,
        })),
      });
    }),
  );

  router.post(
    "/dead-letters/:id/replay",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const delivery = await replayDeadLetter(req.tenant, req.params.id);
      res.json(serializeDelivery(delivery));
    }),
  );

  router.get(
    "/batch-jobs",
    validate({ query: batchJobListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const result = await listBatchJobs(req.tenant.tenantId, query);
      res.json({
        data: result.data.map(serializeBatchJob),
        meta: pageMeta(query.page, query.per_page, result.total),
      });
    }),
  );

  router.post(
    "/batch-jobs",
    requireMinRole("admin"),
    validate({ body: createBatchJobSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const job = await createBatchJob(req.tenant, req.body);
      res.status(201).json(serializeBatchJob(job));
    }),
  );

  router.get(
    "/batch-jobs/:id",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const { job, items } = await getBatchJob(req.tenant.tenantId, req.params.id);
      res.json({
        ...serializeBatchJob(job),
        items: items.map((item) => ({
          id: String(item._id),
          index: item.index,
          status: item.status,
          error: item.error ?? null,
          input: item.input,
        })),
      });
    }),
  );

  router.get(
    "/batch-jobs/:id/failures",
    validate({ query: batchJobFailureQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const result = await batchJobFailures(req.tenant.tenantId, req.params.id, query.page, query.per_page);
      res.json({
        data: result.data.map((item) => ({
          id: String(item._id),
          index: item.index,
          input: item.input,
          error: item.error,
        })),
        meta: pageMeta(query.page, query.per_page, result.total),
      });
    }),
  );

  void NotFoundError;
  return router;
}
