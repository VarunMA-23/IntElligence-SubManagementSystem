import { z } from "zod";
import { listQuerySchema, uuidSchema } from "./common.js";

export const supportedWebhookEvents = [
  "customer.created",
  "customer.updated",
  "customer.archived",
  "subscription.created",
  "subscription.canceled",
  "invoice.finalized",
  "invoice.paid",
  "credit_note.issued",
  "checkout.completed",
  "event.ingested",
] as const;

export const webhookEventSchema = z.enum(supportedWebhookEvents);

export const createWebhookSchema = z
  .object({
    url: z.string().url().refine((v) => v.startsWith("http://") || v.startsWith("https://"), "must be http(s)"),
    events: z.array(webhookEventSchema).min(1).max(supportedWebhookEvents.length),
    secret: z.string().min(16).max(200).optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

export const updateWebhookSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((v) => v.startsWith("http://") || v.startsWith("https://"), "must be http(s)")
      .optional(),
    events: z.array(webhookEventSchema).min(1).max(supportedWebhookEvents.length).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const webhookListQuerySchema = listQuerySchema({});

export const createBatchJobSchema = z
  .object({
    type: z.enum(["customer.import", "invoice.generate"]),
    items: z.array(z.record(z.string(), z.any())).min(1).max(500),
  })
  .strict();

export const batchJobListQuerySchema = listQuerySchema({
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "PARTIAL"]).optional(),
  type: z.string().max(80).optional(),
});

export const batchJobFailureQuerySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(0),
    per_page: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const entityActivityQuerySchema = z
  .object({
    entity_type: z.string().max(80).optional(),
    entity_id: uuidSchema.optional(),
    page: z.coerce.number().int().min(0).default(0),
    per_page: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
