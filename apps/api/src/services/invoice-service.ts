import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Decimal from "decimal.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  dec,
  money,
  type TenantContext,
} from "@brightloop/shared";
import {
  AddOn,
  AppliedCoupon,
  Coupon,
  CreditNote,
  CreditNoteLineItem,
  Customer,
  Invoice,
  InvoiceLineItem,
  InvoicingEntity,
  PlanVersion,
  PriceComponent,
  Subscription,
  SubscriptionAddOn,
  SubscriptionComponent,
} from "@brightloop/db";
import { calculateAmount } from "@brightloop/billing";
import { generateCreditNotePdf, generateInvoicePdf } from "@brightloop/integrations";
import type { AppConfig } from "../config/env.js";
import { emitEvent, nextSequence, recordActivity } from "../lib/domain.js";
import { decimalString } from "../lib/serializers.js";
import { withTransaction } from "../lib/transaction.js";
import { computeMetricUsage } from "./metering-service.js";

interface GenerateOptions {
  subscriptionId?: string;
  customerId?: string;
  periodStart?: string;
  periodEnd?: string;
  finalize?: boolean;
}

function defaultPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function parsePeriod(periodStart?: string, periodEnd?: string) {
  if (!periodStart && !periodEnd) return defaultPeriod();
  const fallback = defaultPeriod();
  const start = periodStart ? new Date(periodStart) : fallback.start;
  const end = periodEnd ? new Date(periodEnd) : fallback.end;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new BadRequestError("invalid invoice period");
  }
  return { start, end };
}

function taxRateFor(customer: any): number {
  if (customer.isTaxExempt) return 0;
  const rates = (customer.customTaxes ?? []).map((tax: any) => Number(decimalString(tax.rate)));
  return rates.reduce((total: number, rate: number) => total + rate, 0);
}

async function appliedCouponDiscount(tenantId: string, subscriptionId: string, subtotal: Decimal, currency: string) {
  const applied = await AppliedCoupon.find({ tenantId, subscriptionId, status: "active" });
  const coupons = [];
  let discount = new Decimal(0);
  for (const entry of applied) {
    const coupon = await Coupon.findOne({ _id: entry.couponId, tenantId });
    if (!coupon || coupon.disabled) continue;
    let amount = new Decimal(0);
    if (coupon.discount.type === "PERCENTAGE") {
      amount = subtotal.mul(dec(coupon.discount.percentage)).div(100);
    } else if (coupon.discount.currency === currency) {
      amount = dec(coupon.discount.amount);
    }
    discount = discount.plus(amount);
    coupons.push({ code: coupon.code, amount: money(amount), discount: coupon.discount });
  }
  if (discount.gt(subtotal)) discount = subtotal;
  return { discount, coupons };
}

async function generateForSubscription(
  ctx: TenantContext,
  subscription: any,
  periodStart: Date,
  periodEnd: Date,
  finalize: boolean,
) {
  const existing = await Invoice.findOne({
    tenantId: ctx.tenantId,
    subscriptionId: String(subscription._id),
    periodStart,
    periodEnd,
    status: { $ne: "VOID" },
  });
  if (existing) return existing;

  const customer = await Customer.findOne({ _id: subscription.customerId, tenantId: ctx.tenantId });
  if (!customer) throw new NotFoundError("Customer");
  const version = await PlanVersion.findOne({ _id: subscription.planVersionId, tenantId: ctx.tenantId });
  if (!version) throw new NotFoundError("Plan version");
  const components = await PriceComponent.find({
    tenantId: ctx.tenantId,
    planVersionId: String(version._id),
  }).sort({ order: 1 });
  const subscriptionComponents = await SubscriptionComponent.find({
    tenantId: ctx.tenantId,
    subscriptionId: String(subscription._id),
  });
  const quantityByComponent = new Map(
    subscriptionComponents.map((component) => [component.priceComponentId, component.quantity]),
  );
  const taxRate = taxRateFor(customer);

  const lines: any[] = [];
  let gross = new Decimal(0);
  let recurring = new Decimal(0);
  let order = 0;
  for (const component of components) {
    let quantity = new Decimal(quantityByComponent.get(String(component._id)) ?? 1);
    if (component.metricId) {
      const metricCode = component.metricId;
      const { BillableMetric } = await import("@brightloop/db");
      const metric = await BillableMetric.findOne({ _id: metricCode, tenantId: ctx.tenantId });
      if (!metric) continue;
      const usage = await computeMetricUsage({
        tenantId: ctx.tenantId,
        customerId: String(customer._id),
        metric,
        periodStart,
        periodEnd,
      });
      quantity = dec(usage.total);
    }
    const priced = calculateAmount(component.pricing as any, quantity.toString());
    const amount = dec(priced.amount);
    const unitPrice = quantity.isZero() ? amount : amount.div(quantity);
    const lineTax = amount.mul(taxRate).div(100);
    gross = gross.plus(amount);
    if (component.feeType !== "USAGE") recurring = recurring.plus(amount);
    lines.push({
      tenantId: ctx.tenantId,
      invoiceId: null,
      productId: component.productId ?? null,
      metricCode: null,
      name: component.name,
      description: component.feeType === "USAGE" ? "Usage-based charge" : "Recurring charge",
      quantity: money(quantity),
      unitPrice: money(unitPrice),
      amountTotal: money(amount),
      taxRate: money(taxRate),
      taxAmount: money(lineTax),
      periodStart,
      periodEnd,
      subLineItems: priced.breakdown,
      order: order += 1,
    });
  }

  if (!lines.length) throw new ConflictError("Subscription has no billable components");
  const tax = gross.mul(taxRate).div(100);
  const couponResult = await appliedCouponDiscount(ctx.tenantId, String(subscription._id), gross, subscription.currency);
  const total = gross.plus(tax).minus(couponResult.discount);
  const invoiceDate = new Date();
  const dueDate = new Date(invoiceDate.getTime() + (subscription.netTerms ?? 30) * 86_400_000);
  const provisionalNumber = `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const invoice = await withTransaction(async (session) => {
    const [created] = await Invoice.create(
      [
        {
          tenantId: ctx.tenantId,
          customerId: String(customer._id),
          subscriptionId: String(subscription._id),
          number: provisionalNumber,
          status: "DRAFT",
          invoiceType: "RECURRING",
          currency: subscription.currency,
          invoiceDate,
          dueDate,
          netTerms: subscription.netTerms ?? 30,
          subtotal: money(gross),
          subtotalRecurring: money(recurring),
          taxAmount: money(tax),
          total: money(total),
          amountDue: money(total),
          appliedCredits: "0",
          couponDiscount: couponResult.discount.toString(),
          coupons: couponResult.coupons,
          memo: subscription.invoiceMemo ?? null,
          purchaseOrder: subscription.purchaseOrder ?? null,
          customerDetails: {
            id: String(customer._id),
            name: customer.name,
            email: customer.billingEmail ?? customer.invoicingEmails?.[0] ?? null,
            address: customer.billingAddress ?? null,
            vat_number: customer.vatNumber ?? null,
          },
          taxBreakdown: taxRate > 0 ? [{ name: "Tax", rate: String(taxRate), amount: money(tax) }] : [],
          periodStart,
          periodEnd,
        },
      ],
      session ? { session } : undefined,
    );
    await InvoiceLineItem.create(
      lines.map((line) => ({ ...line, invoiceId: String(created._id) })) as any,
      session ? { session } : undefined,
    );
    return created;
  });

  if (finalize || total.isZero()) {
    return finalizeInvoice(ctx, String(invoice._id));
  }
  return invoice;
}

export async function finalizeInvoice(ctx: TenantContext, invoiceId: string) {
  const invoice = await Invoice.findOne({ _id: invoiceId, tenantId: ctx.tenantId });
  if (!invoice) throw new NotFoundError("Invoice");
  if (invoice.status !== "DRAFT") throw new ConflictError("Only draft invoices can be finalized");
  const number = await nextSequence(ctx.tenantId, "INV", new Date(invoice.invoiceDate));
  const finalized = await withTransaction(async (session) => {
    invoice.number = number;
    invoice.status = "FINALIZED";
    invoice.finalizedAt = new Date();
    await invoice.save(session ? { session } : undefined);
    await emitEvent(
      ctx,
      "invoice.finalized",
      { invoiceId: String(invoice._id), number, total: decimalString(invoice.total) },
      session,
    );
    return invoice;
  });
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "invoice",
    entityId: invoiceId,
    action: "finalized",
    actorId: ctx.actorId,
    diff: { number },
  });
  return finalized;
}

export async function generateInvoices(ctx: TenantContext, options: GenerateOptions) {
  const { start, end } = parsePeriod(options.periodStart, options.periodEnd);
  const filter: Record<string, unknown> = {
    tenantId: ctx.tenantId,
    status: { $in: ["ACTIVE", "TRIAL_ACTIVE", "TRIAL_EXPIRED", "PAST_DUE"] },
  };
  if (options.subscriptionId) filter._id = options.subscriptionId;
  if (options.customerId) filter.customerId = options.customerId;
  const subscriptions = await Subscription.find(filter);
  if (!subscriptions.length) throw new NotFoundError("Subscription");
  const results = [];
  for (const subscription of subscriptions) {
    results.push(await generateForSubscription(ctx, subscription, start, end, Boolean(options.finalize)));
  }
  return results;
}

export async function createCreditNote(ctx: TenantContext, invoiceId: string, input: any) {
  const invoice = await Invoice.findOne({ _id: invoiceId, tenantId: ctx.tenantId });
  if (!invoice) throw new NotFoundError("Invoice");
  if (invoice.status === "VOID") throw new ConflictError("Void invoices cannot receive credit notes");
  if (invoice.status !== "FINALIZED") throw new ConflictError("Only finalized invoices can receive credit notes");
  const alreadyCredited = dec(decimalString(invoice.appliedCredits));
  const remaining = dec(decimalString(invoice.total)).minus(alreadyCredited);
  const requested = dec(input.total);
  if (requested.lte(0)) throw new BadRequestError("credit note total must be positive");
  if (requested.gt(remaining)) throw new ConflictError("credit note exceeds the remaining invoice amount");
  const number = await nextSequence(ctx.tenantId, "CN", new Date());
  const note = await withTransaction(async (session) => {
    const [created] = await CreditNote.create(
      [
        {
          tenantId: ctx.tenantId,
          invoiceId: String(invoice._id),
          customerId: invoice.customerId,
          number,
          status: "ISSUED",
          currency: invoice.currency,
          total: input.total,
          reason: input.reason,
          issuedAt: new Date(),
        },
      ],
      session ? { session } : undefined,
    );
    const lines = (input.line_items ?? [
      { description: input.reason, quantity: "1", unit_price: input.total },
    ]).map((line: any) => ({
      tenantId: ctx.tenantId,
      creditNoteId: String(created._id),
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      amount: money(dec(line.quantity).mul(dec(line.unit_price))),
    }));
    await CreditNoteLineItem.create(lines as any, session ? { session } : undefined);
    invoice.appliedCredits = money(alreadyCredited.plus(requested));
    const due = Decimal.max(new Decimal(0), dec(decimalString(invoice.total)).minus(alreadyCredited.plus(requested)));
    invoice.amountDue = money(due);
    await invoice.save(session ? { session } : undefined);
    await emitEvent(
      ctx,
      "credit_note.issued",
      { creditNoteId: String(created._id), invoiceId: String(invoice._id), total: input.total },
      session,
    );
    return created;
  });
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "credit_note",
    entityId: String(note._id),
    action: "issued",
    actorId: ctx.actorId,
    diff: { invoiceId, total: input.total },
  });
  return note;
}

export async function voidInvoice(ctx: TenantContext, invoiceId: string, reason: string) {
  const invoice = await Invoice.findOne({ _id: invoiceId, tenantId: ctx.tenantId });
  if (!invoice) throw new NotFoundError("Invoice");
  if (invoice.status === "VOID") throw new ConflictError("Invoice is already void");
  if (invoice.paidAt) throw new ConflictError("Paid invoices cannot be voided; issue a credit note instead");
  invoice.status = "VOID";
  invoice.amountDue = "0";
  invoice.voidedAt = new Date();
  invoice.memo = invoice.memo ? `${invoice.memo}\nVoided: ${reason}` : `Voided: ${reason}`;
  await invoice.save();
  await emitEvent(ctx, "invoice.voided", { invoiceId, reason });
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "invoice",
    entityId: invoiceId,
    action: "voided",
    actorId: ctx.actorId,
    diff: { reason },
  });
  return invoice;
}

export async function invoiceWithLines(tenantId: string, invoiceId: string) {
  const invoice = await Invoice.findOne({ _id: invoiceId, tenantId });
  if (!invoice) throw new NotFoundError("Invoice");
  const lines = await InvoiceLineItem.find({ tenantId, invoiceId }).sort({ order: 1 });
  return { invoice, lines };
}

export async function invoicePdfBuffer(config: AppConfig, tenantId: string, invoiceId: string) {
  const { invoice, lines } = await invoiceWithLines(tenantId, invoiceId);
  const customer = await Customer.findOne({ _id: invoice.customerId, tenantId });
  const buffer = await generateInvoicePdf({
    number: invoice.number,
    status: invoice.status,
    invoiceDate: new Date(invoice.invoiceDate),
    dueDate: invoice.dueDate ? new Date(invoice.dueDate) : null,
    currency: invoice.currency,
    subtotal: decimalString(invoice.subtotal),
    taxAmount: decimalString(invoice.taxAmount),
    total: decimalString(invoice.total),
    amountDue: decimalString(invoice.amountDue),
    customerName: customer?.name ?? "Customer",
    customerEmail: customer?.billingEmail ?? customer?.invoicingEmails?.[0] ?? null,
    lineItems: lines.map((line) => ({
      name: line.name,
      description: line.description,
      quantity: decimalString(line.quantity),
      unitPrice: decimalString(line.unitPrice),
      amountTotal: decimalString(line.amountTotal),
    })),
  });
  const dir = path.resolve(config.STORAGE_DIR, "invoices");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${invoiceId}.pdf`);
  await writeFile(filePath, buffer);
  if (invoice.pdfObjectKey !== filePath) {
    invoice.pdfObjectKey = filePath;
    await invoice.save();
  }
  return buffer;
}

export async function creditNotePdfBuffer(config: AppConfig, tenantId: string, creditNoteId: string) {
  const note = await CreditNote.findOne({ _id: creditNoteId, tenantId });
  if (!note) throw new NotFoundError("Credit note");
  const invoice = await Invoice.findOne({ _id: note.invoiceId, tenantId });
  const customer = await Customer.findOne({ _id: note.customerId, tenantId });
  const buffer = await generateCreditNotePdf({
    number: note.number,
    invoiceNumber: invoice?.number ?? "",
    customerName: customer?.name ?? "Customer",
    currency: note.currency,
    total: decimalString(note.total),
    reason: note.reason,
    issuedAt: note.issuedAt ? new Date(note.issuedAt) : null,
  });
  const dir = path.resolve(config.STORAGE_DIR, "credit-notes");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${creditNoteId}.pdf`);
  await writeFile(filePath, buffer);
  if (note.pdfObjectKey !== filePath) {
    note.pdfObjectKey = filePath;
    await note.save();
  }
  return buffer;
}

export async function invoicesForCustomer(tenantId: string, customerId: string) {
  return Invoice.find({ tenantId, customerId }).sort({ createdAt: -1 });
}

export async function invoicingEntityForCustomer(tenantId: string, customer: any) {
  return InvoicingEntity.findOne({ _id: customer.invoicingEntityId, tenantId });
}
