import Decimal from "decimal.js";
import { BadRequestError, dec, money, sum } from "@brightloop/shared";

export interface LineItemInput {
  quantity: string | number;
  unitPrice: string | number;
  taxRate: string | number;
}

export interface InvoiceTotals {
  subtotal: string;
  taxAmount: string;
  total: string;
  amountDue: string;
  taxBreakdown: Array<{ name: string; rate: string; amount: string }>;
}

export function computeLineItem(line: LineItemInput) {
  const quantity = dec(line.quantity);
  const unitPrice = dec(line.unitPrice);
  const taxRate = dec(line.taxRate);
  if (quantity.isNegative()) throw new BadRequestError("line item quantity must be non-negative");
  if (unitPrice.isNegative()) throw new BadRequestError("line item unit price must be non-negative");
  if (taxRate.isNegative() || taxRate.gt(100)) throw new BadRequestError("tax rate must be between 0 and 100");
  const amount = quantity.mul(unitPrice);
  const taxAmount = amount.mul(taxRate).div(100);
  return { amount, taxAmount, amountTotal: money(amount), taxAmountTotal: money(taxAmount) };
}

export function computeInvoiceTotals(
  lines: Array<LineItemInput & { name?: string }>,
  appliedCredits: string | number = "0",
): InvoiceTotals {
  const subtotal = sum(lines.map((line) => computeLineItem(line).amount));
  const taxAmount = sum(lines.map((line) => computeLineItem(line).taxAmount));
  const total = subtotal.plus(taxAmount);
  const credits = dec(appliedCredits);
  if (credits.isNegative()) throw new BadRequestError("applied credits must be non-negative");
  const amountDue = Decimal.max(new Decimal(0), total.minus(credits));

  const grouped = new Map<string, { rate: Decimal; amount: Decimal }>();
  for (const line of lines) {
    const key = `${line.name ?? "tax"}:${line.taxRate}`;
    const amount = computeLineItem(line).taxAmount;
    const existing = grouped.get(key) ?? { rate: dec(line.taxRate), amount: new Decimal(0) };
    existing.amount = existing.amount.plus(amount);
    grouped.set(key, existing);
  }

  return {
    subtotal: money(subtotal),
    taxAmount: money(taxAmount),
    total: money(total),
    amountDue: money(amountDue),
    taxBreakdown: [...grouped.entries()].map(([key, value]) => ({
      name: key.split(":")[0]!,
      rate: value.rate.toString(),
      amount: money(value.amount),
    })),
  };
}

export function assertConsistentTotals(input: {
  subtotal: string;
  taxAmount: string;
  total: string;
  amountDue: string;
  appliedCredits?: string;
}): void {
  const subtotal = dec(input.subtotal);
  const tax = dec(input.taxAmount);
  const total = dec(input.total);
  const credits = dec(input.appliedCredits ?? "0");
  const amountDue = dec(input.amountDue);
  if (!subtotal.plus(tax).eq(total)) {
    throw new BadRequestError("invoice total is inconsistent");
  }
  if (!Decimal.max(new Decimal(0), total.minus(credits)).eq(amountDue)) {
    throw new BadRequestError("invoice amount due is inconsistent");
  }
}
