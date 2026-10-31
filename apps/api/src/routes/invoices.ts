import { Router } from "express";
import {
  ForbiddenError,
  NotFoundError,
  createCreditNoteSchema,
  generateInvoiceSchema,
  invoiceListQuerySchema,
  voidInvoiceSchema,
} from "@brightloop/shared";
import { CreditNote, Invoice, InvoiceLineItem } from "@brightloop/db";
import type { AppConfig } from "../config/env.js";
import { asyncHandler, pageMeta } from "../lib/http.js";
import {
  serializeCreditNote,
  serializeInvoice,
} from "../lib/serializers.js";
import { requireMinRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createCreditNote,
  creditNotePdfBuffer,
  finalizeInvoice,
  generateInvoices,
  invoicePdfBuffer,
  invoiceWithLines,
  voidInvoice,
} from "../services/invoice-service.js";

export function invoiceRoutes(config: AppConfig) {
  const router = Router();

  router.get(
    "/invoices",
    validate({ query: invoiceListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const filter: Record<string, unknown> = { tenantId: req.tenant.tenantId };
      if (query.customer_id) filter.customerId = query.customer_id;
      if (query.subscription_id) filter.subscriptionId = query.subscription_id;
      if (query.status) filter.status = query.status;
      const sort = query.order_by
        ? { [query.order_by.split(".")[0]!]: query.order_by.endsWith(".asc") ? 1 : -1 }
        : { createdAt: -1 };
      const [invoices, total] = await Promise.all([
        Invoice.find(filter)
          .sort(sort as any)
          .skip(query.page * query.per_page)
          .limit(query.per_page),
        Invoice.countDocuments(filter),
      ]);
      res.json({
        data: invoices.map((invoice) => serializeInvoice(invoice)),
        meta: pageMeta(query.page, query.per_page, total),
      });
    }),
  );

  router.post(
    "/invoices/generate",
    requireMinRole("admin"),
    validate({ body: generateInvoiceSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const invoices = await generateInvoices(req.tenant, {
        subscriptionId: req.body.subscription_id,
        customerId: req.body.customer_id,
        periodStart: req.body.period_start,
        periodEnd: req.body.period_end,
        finalize: req.body.finalize,
      });
      const withLines = [];
      for (const invoice of invoices) {
        const details = await invoiceWithLines(req.tenant.tenantId, String(invoice._id));
        withLines.push(serializeInvoice(details.invoice, details.lines));
      }
      res.status(201).json({ data: withLines });
    }),
  );

  router.get(
    "/invoices/:id",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const { invoice, lines } = await invoiceWithLines(req.tenant.tenantId, req.params.id);
      res.json(serializeInvoice(invoice, lines));
    }),
  );

  router.post(
    "/invoices/:id/finalize",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const invoice = await finalizeInvoice(req.tenant, req.params.id);
      const lines = await InvoiceLineItem.find({
        tenantId: req.tenant.tenantId,
        invoiceId: String(invoice._id),
      }).sort({ order: 1 });
      res.json(serializeInvoice(invoice, lines));
    }),
  );

  router.post(
    "/invoices/:id/void",
    requireMinRole("admin"),
    validate({ body: voidInvoiceSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeInvoice(await voidInvoice(req.tenant, req.params.id, req.body.reason)));
    }),
  );

  router.get(
    "/invoices/:id/pdf",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const buffer = await invoicePdfBuffer(config, req.tenant.tenantId, req.params.id);
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${req.params.id}.pdf"`);
      res.send(buffer);
    }),
  );

  router.post(
    "/invoices/:id/credit-notes",
    requireMinRole("admin"),
    validate({ body: createCreditNoteSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const note = await createCreditNote(req.tenant, req.params.id, req.body);
      res.status(201).json(serializeCreditNote(note));
    }),
  );

  router.get(
    "/credit-notes",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const notes = await CreditNote.find({ tenantId: req.tenant.tenantId }).sort({ createdAt: -1 });
      res.json({ data: notes.map(serializeCreditNote) });
    }),
  );

  router.get(
    "/credit-notes/:id",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const note = await CreditNote.findOne({ _id: req.params.id, tenantId: req.tenant.tenantId });
      if (!note) throw new NotFoundError("Credit note");
      res.json(serializeCreditNote(note));
    }),
  );

  router.get(
    "/credit-notes/:id/pdf",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const buffer = await creditNotePdfBuffer(config, req.tenant.tenantId, req.params.id);
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${req.params.id}.pdf"`);
      res.send(buffer);
    }),
  );

  return router;
}
