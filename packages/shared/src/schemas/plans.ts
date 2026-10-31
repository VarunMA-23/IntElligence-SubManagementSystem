import { z } from "zod";
import {
  aliasSchema,
  currencySchema,
  entitlementInputSchema,
  listQuerySchema,
  positiveMoneySchema,
  uuidSchema,
} from "./common.js";

export const billingPeriodSchema = z.enum(["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"]);
export const billingTypeSchema = z.enum(["ADVANCE", "ARREARS"]);
export const pricingTypeSchema = z.enum(["FLAT", "PER_UNIT", "PACKAGE", "TIERED", "VOLUME"]);

export const tierRowSchema = z
  .object({
    first_unit: z.number().int().min(0),
    rate: positiveMoneySchema,
    flat_fee: positiveMoneySchema.nullable().optional(),
    flat_cap: positiveMoneySchema.nullable().optional(),
  })
  .strict();

export const pricingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FLAT"), rate: positiveMoneySchema }).strict(),
  z.object({ type: z.literal("PER_UNIT"), rate: positiveMoneySchema }).strict(),
  z
    .object({ type: z.literal("PACKAGE"), block_size: z.number().int().positive(), rate: positiveMoneySchema })
    .strict(),
  z
    .object({
      type: z.literal("TIERED"),
      block_size: z.number().int().positive().optional(),
      tiers: z.array(tierRowSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("VOLUME"),
      block_size: z.number().int().positive().optional(),
      tiers: z.array(tierRowSchema).min(1),
    })
    .strict(),
]);

export const priceComponentInputSchema = z
  .object({
    product_id: uuidSchema.nullable().optional(),
    metric_id: uuidSchema.nullable().optional(),
    name: z.string().trim().min(1).max(200),
    fee_type: z.enum(["RATE", "USAGE", "ONE_TIME", "EXTRA_RECURRING"]),
    billing_period: billingPeriodSchema,
    billing_type: billingTypeSchema,
    pricing: pricingSchema,
    order: z.number().int().min(0).default(0),
  })
  .strict();

export const createPlanSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    alias: aliasSchema,
    description: z.string().max(2000).nullable().optional(),
    plan_type: z.enum(["STANDARD", "FREE", "CUSTOM"]).default("STANDARD"),
    product_family_id: uuidSchema,
    currency: currencySchema,
    billing_period: billingPeriodSchema.default("MONTHLY"),
    billing_type: billingTypeSchema.default("ADVANCE"),
    net_terms: z.number().int().min(0).max(365).default(30),
    trial_days: z.number().int().min(0).max(365).default(0),
    self_service_rank: z.number().int().min(0).nullable().optional(),
    components: z.array(priceComponentInputSchema).min(1),
    entitlements: z.array(entitlementInputSchema).max(50).optional(),
  })
  .strict();

export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    plan_type: z.enum(["STANDARD", "FREE", "CUSTOM"]).optional(),
    self_service_rank: z.number().int().min(0).nullable().optional(),
    components: z.array(priceComponentInputSchema).min(1).optional(),
    entitlements: z.array(entitlementInputSchema).max(50).optional(),
  })
  .strict();

export const publishPlanSchema = z
  .object({
    components: z.array(priceComponentInputSchema).min(1).optional(),
    entitlements: z.array(entitlementInputSchema).max(50).optional(),
    trial_days: z.number().int().min(0).max(365).optional(),
  })
  .strict();

export const planListQuerySchema = listQuerySchema({
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  order_by: z.string().regex(/^(name|alias|created_at)\.(asc|desc)$/).optional(),
});
