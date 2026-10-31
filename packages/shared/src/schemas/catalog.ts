import { z } from "zod";
import {
  aliasSchema,
  codeSchema,
  entitlementInputSchema,
  listQuerySchema,
  uuidSchema,
} from "./common.js";

export const createProductFamilySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    alias: aliasSchema,
  })
  .strict();

export const updateProductFamilySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    alias: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/).optional(),
  })
  .strict();

export const feeTypeSchema = z.enum(["RATE", "SLOT", "CAPACITY", "USAGE", "EXTRA_RECURRING", "ONE_TIME"]);

export const createProductSchema = z
  .object({
    family_id: uuidSchema,
    name: z.string().trim().min(1).max(200),
    alias: aliasSchema,
    description: z.string().max(2000).nullable().optional(),
    fee_type: feeTypeSchema,
    entitlements: z.array(entitlementInputSchema).max(50).optional(),
  })
  .strict();

export const updateProductSchema = z
  .object({
    family_id: uuidSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    fee_type: feeTypeSchema.optional(),
  })
  .strict();

export const createFeatureSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: codeSchema,
    feature_type: z.enum(["BOOLEAN", "METERED"]),
    entitlements: z.array(entitlementInputSchema).max(50).optional(),
  })
  .strict();

export const aggregationSchema = z.enum(["COUNT", "LATEST", "MAX", "MIN", "MEAN", "SUM", "COUNT_DISTINCT"]);

export const createMetricSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: codeSchema,
    aggregation: aggregationSchema,
    field: z.string().max(128).nullable().optional(),
    segmentation_keys: z.array(z.string().min(1).max(64)).max(10).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.aggregation !== "COUNT" && !value.field) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["field"], message: "field is required for this aggregation" });
    }
    if (new Set(value.segmentation_keys).size !== value.segmentation_keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["segmentation_keys"], message: "keys must be unique" });
    }
  });

export const updateMetricSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    aggregation: aggregationSchema.optional(),
    field: z.string().max(128).nullable().optional(),
    segmentation_keys: z.array(z.string().min(1).max(64)).max(10).optional(),
  })
  .strict();

export const catalogListQuerySchema = listQuerySchema({
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  family_id: uuidSchema.optional(),
});
