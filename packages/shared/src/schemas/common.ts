import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const idOrAliasSchema = z.string().min(1).max(128);
export const aliasSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/, "must match ^[a-z0-9][a-z0-9_-]{1,63}$");
export const codeSchema = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/, "must be 1-128 chars of letters, numbers, _ . -");
export const moneySchema = z.string().regex(/^-?\d+(\.\d{1,4})?$/, "must be a decimal string");
export const positiveMoneySchema = z.string().regex(/^\d+(\.\d{1,4})?$/, "must be a non-negative decimal string");
export const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/);
export const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
export const emailSchema = z.string().email().max(254).toLowerCase();
export const nameSchema = z.string().trim().min(1).max(200);
export const isoDateSchema = z.string().datetime({ offset: true }).or(z.string().date());

export const addressSchema = z
  .object({
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).nullable().optional(),
    city: z.string().min(1).max(120),
    state: z.string().max(120).nullable().optional(),
    postal_code: z.string().min(1).max(32),
    country: z.string().length(2).regex(/^[A-Z]{2}$/),
  })
  .strict();

export const customTaxRateSchema = z
  .object({
    name: z.string().min(1).max(120),
    rate: positiveMoneySchema.refine((v) => Number(v) <= 100, "rate must be between 0 and 100"),
  })
  .strict();

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(0),
    per_page: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export function listQuerySchema<T extends z.ZodRawShape>(extra: T) {
  return z
    .object({
      page: z.coerce.number().int().min(0).default(0),
      per_page: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().trim().max(100).optional(),
      ...extra,
    })
    .strict();
}

export const resetPeriodSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BILLING_CYCLE") }).strict(),
  z
    .object({
      type: z.literal("CALENDAR"),
      unit: z.enum(["DAY", "WEEK", "MONTH", "YEAR"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("FIXED_WINDOW"),
      duration_days: z.number().int().min(1).max(3650),
    })
    .strict(),
  z
    .object({
      type: z.literal("SLIDING_WINDOW"),
      duration_days: z.number().int().min(1).max(3650),
    })
    .strict(),
  z.object({ type: z.literal("NEVER") }).strict(),
]);

export const entitlementValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BOOLEAN"), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("METERED"),
      limit: z.number().int().positive(),
      reset_period: resetPeriodSchema,
    })
    .strict(),
]);

export const entitlementInputSchema = z
  .object({
    feature_id: uuidSchema,
    value: entitlementValueSchema,
  })
  .strict();
