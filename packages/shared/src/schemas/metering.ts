import { z } from "zod";
import { isoDateSchema } from "./common.js";

export const rawEventSchema = z
  .object({
    event_id: z.string().min(1).max(255),
    code: z.string().min(1).max(512),
    customer_id: z.string().min(1).max(128),
    timestamp: isoDateSchema,
    properties: z
      .record(z.string().max(512), z.string().max(512))
      .refine((v) => Object.keys(v).length <= 50, "at most 50 properties")
      .default({}),
  })
  .strict();

export const ingestEventsSchema = z
  .object({
    events: z.array(rawEventSchema).min(1).max(100),
    allow_backfilling: z.boolean().default(false),
    allow_partial_failures: z.boolean().default(false),
  })
  .strict();

export const usageQuerySchema = z
  .object({
    period_start: isoDateSchema.optional(),
    period_end: isoDateSchema.optional(),
    metric_code: z.string().max(512).optional(),
  })
  .strict();

export const summaryQuerySchema = z
  .object({
    period_start: isoDateSchema.optional(),
    period_end: isoDateSchema.optional(),
  })
  .strict();
