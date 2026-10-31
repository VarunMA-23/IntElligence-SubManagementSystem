import { z } from "zod";
import { listQuerySchema, uuidSchema } from "./common.js";

const httpUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), "must be http(s)");

export const portalTokenSchema = z.object({}).strict();

export const createPortalTokenSchema = z
  .object({
    customer_id: uuidSchema,
  })
  .strict();

export const createCheckoutSchema = z
  .object({
    customer_id: uuidSchema,
    plan_version_id: uuidSchema.optional(),
    plan_id: uuidSchema.optional(),
    success_url: httpUrl.nullable().optional(),
    cancel_url: httpUrl.nullable().optional(),
    trial_days: z.number().int().min(0).max(365).optional(),
    coupon_codes: z.array(z.string().min(1).max(64)).max(10).default([]),
  })
  .strict()
  .refine((v) => Boolean(v.plan_version_id || v.plan_id), "plan_version_id or plan_id is required");

export const completeCheckoutSchema = z
  .object({
    simulate_failure: z.boolean().default(false),
  })
  .strict();

export const checkoutListQuerySchema = listQuerySchema({
  customer_id: uuidSchema.optional(),
  status: z.enum(["PENDING", "COMPLETED", "CANCELED", "EXPIRED", "FAILED"]).optional(),
});
