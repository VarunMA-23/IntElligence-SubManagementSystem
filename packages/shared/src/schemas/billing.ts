import { z } from "zod";
import { isoDateSchema, listQuerySchema, positiveMoneySchema, uuidSchema } from "./common.js";

export const invoiceStatusSchema = z.enum(["DRAFT", "FINALIZED", "UNCOLLECTIBLE", "VOID"]);
export const invoiceTypeSchema = z.enum(["RECURRING", "ONE_OFF", "ADJUSTMENT", "USAGE_THRESHOLD"]);

export const invoiceListQuerySchema = listQuerySchema({
  customer_id: uuidSchema.optional(),
  subscription_id: uuidSchema.optional(),
  status: invoiceStatusSchema.optional(),
  order_by: z.string().regex(/^(created_at|due_date|total)\.(asc|desc)$/).optional(),
});

export const generateInvoiceSchema = z
  .object({
    subscription_id: uuidSchema.optional(),
    customer_id: uuidSchema.optional(),
    period_start: isoDateSchema.optional(),
    period_end: isoDateSchema.optional(),
    finalize: z.boolean().default(false),
  })
  .strict();

export const createCreditNoteSchema = z
  .object({
    total: positiveMoneySchema,
    reason: z.string().trim().min(1).max(500),
    line_items: z
      .array(
        z
          .object({
            description: z.string().min(1).max(500),
            quantity: positiveMoneySchema.default("1"),
            unit_price: positiveMoneySchema,
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export const voidInvoiceSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
