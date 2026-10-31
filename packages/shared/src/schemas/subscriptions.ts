import { z } from "zod";
import {
  aliasSchema,
  codeSchema,
  currencySchema,
  entitlementInputSchema,
  isoDateSchema,
  listQuerySchema,
  positiveMoneySchema,
  uuidSchema,
} from "./common.js";
import { pricingSchema } from "./plans.js";

export const subscriptionStatusSchema = z.enum([
  "PENDING_ACTIVATION",
  "PENDING_CHARGE",
  "TRIAL_ACTIVE",
  "ACTIVE",
  "TRIAL_EXPIRED",
  "PAUSED",
  "SUSPENDED",
  "CANCELLED",
  "COMPLETED",
  "SUPERSEDED",
  "ERRORED",
]);

export const createSubscriptionSchema = z
  .object({
    plan_id: uuidSchema,
    customer_id_or_alias: z.string().min(1).max(128),
    start_date: isoDateSchema.optional(),
    activation_condition: z.enum(["ON_START", "ON_CHECKOUT", "MANUAL"]).default("ON_START"),
    trial_days: z.number().int().min(0).max(365).default(0),
    billing_day_anchor: z.number().int().min(1).max(31).default(1),
    net_terms: z.number().int().min(0).max(365).default(30),
    coupon_codes: z.array(z.string().min(1).max(64)).max(10).default([]),
    add_ons: z
      .array(
        z
          .object({
            add_on_id: uuidSchema,
            quantity: z.number().int().positive().default(1),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    auto_advance_invoices: z.boolean().default(true),
    charge_automatically: z.boolean().default(false),
    purchase_order: z.string().max(120).nullable().optional(),
    invoice_memo: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const updateSubscriptionSchema = z
  .object({
    billing_day_anchor: z.number().int().min(1).max(31).optional(),
    net_terms: z.number().int().min(0).max(365).optional(),
    auto_advance_invoices: z.boolean().optional(),
    charge_automatically: z.boolean().optional(),
    purchase_order: z.string().max(120).nullable().optional(),
    invoice_memo: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const cancelSubscriptionSchema = z
  .object({
    effective_date: isoDateSchema.optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const subscriptionListQuerySchema = listQuerySchema({
  customer_id: uuidSchema.optional(),
  customer_id_or_alias: z.string().min(1).max(128).optional(),
  status: subscriptionStatusSchema.optional(),
});

export const couponDiscountSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("PERCENTAGE"),
      percentage: positiveMoneySchema.refine((v) => Number(v) <= 100, "percentage must be 0-100"),
    })
    .strict(),
  z
    .object({
      type: z.literal("FIXED"),
      currency: currencySchema,
      amount: positiveMoneySchema,
    })
    .strict(),
]);

export const createCouponSchema = z
  .object({
    code: codeSchema,
    description: z.string().max(1000).nullable().optional(),
    discount: couponDiscountSchema,
    reusable: z.boolean().default(false),
    redemption_limit: z.number().int().positive().nullable().optional(),
    recurring_value: z.number().int().positive().nullable().optional(),
    expires_at: isoDateSchema.nullable().optional(),
    plan_ids: z.array(uuidSchema).max(50).default([]),
  })
  .strict();

export const updateCouponSchema = z
  .object({
    description: z.string().max(1000).nullable().optional(),
    reusable: z.boolean().optional(),
    redemption_limit: z.number().int().positive().nullable().optional(),
    recurring_value: z.number().int().positive().nullable().optional(),
    expires_at: isoDateSchema.nullable().optional(),
    plan_ids: z.array(uuidSchema).max(50).optional(),
  })
  .strict();

export const couponListQuerySchema = listQuerySchema({
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const createAddOnSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    alias: aliasSchema,
    product_id: uuidSchema,
    description: z.string().max(2000).nullable().optional(),
    fee_type: z.string().max(40).nullable().optional(),
    self_serviceable: z.boolean().default(true),
    max_instances_per_subscription: z.number().int().positive().nullable().optional(),
    pricing: pricingSchema,
    entitlements: z.array(entitlementInputSchema).max(50).optional(),
  })
  .strict();

export const updateAddOnSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    self_serviceable: z.boolean().optional(),
    max_instances_per_subscription: z.number().int().positive().nullable().optional(),
    pricing: pricingSchema.optional(),
  })
  .strict();

export const addOnListQuerySchema = listQuerySchema({
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
