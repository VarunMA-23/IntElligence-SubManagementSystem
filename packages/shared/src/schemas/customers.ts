import { z } from "zod";
import {
  addressSchema,
  aliasSchema,
  currencySchema,
  customTaxRateSchema,
  emailSchema,
  listQuerySchema,
  uuidSchema,
} from "./common.js";

export const createCustomerSchema = z
  .object({
    alias: aliasSchema,
    name: z.string().trim().min(1).max(200),
    invoicing_emails: z.array(emailSchema).min(1).max(10),
    billing_email: emailSchema.nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    vat_number: z.string().max(32).nullable().optional(),
    currency: currencySchema.default("USD"),
    invoicing_entity_id: uuidSchema.optional(),
    billing_address: addressSchema.nullable().optional(),
    shipping_address: addressSchema.nullable().optional(),
    custom_taxes: z.array(customTaxRateSchema).max(10).default([]),
    is_tax_exempt: z.boolean().default(false),
    exemption_reason: z.string().max(500).nullable().optional(),
  })
  .strict();

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    invoicing_emails: z.array(emailSchema).min(1).max(10).optional(),
    billing_email: emailSchema.nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    vat_number: z.string().max(32).nullable().optional(),
    currency: currencySchema.optional(),
    invoicing_entity_id: uuidSchema.optional(),
    billing_address: addressSchema.nullable().optional(),
    shipping_address: addressSchema.nullable().optional(),
    custom_taxes: z.array(customTaxRateSchema).max(10).optional(),
    is_tax_exempt: z.boolean().optional(),
    exemption_reason: z.string().max(500).nullable().optional(),
  })
  .strict();

export const customerListQuerySchema = listQuerySchema({
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  order_by: z
    .string()
    .regex(/^(name|email|alias|created_at)\.(asc|desc)$/)
    .optional(),
});
