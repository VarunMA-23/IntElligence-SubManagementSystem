import { BadRequestError } from "@brightloop/shared";

export type BillingPeriod = "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";

export function addBillingPeriod(date: Date, period: BillingPeriod, count = 1): Date {
  const next = new Date(date);
  switch (period) {
    case "MONTHLY":
      next.setUTCMonth(next.getUTCMonth() + count);
      break;
    case "QUARTERLY":
      next.setUTCMonth(next.getUTCMonth() + 3 * count);
      break;
    case "SEMIANNUAL":
      next.setUTCMonth(next.getUTCMonth() + 6 * count);
      break;
    case "ANNUAL":
      next.setUTCFullYear(next.getUTCFullYear() + count);
      break;
  }
  return next;
}

export function currentPeriod(start: Date, period: BillingPeriod): { start: Date; end: Date } {
  return { start, end: addBillingPeriod(start, period) };
}

export function monthPeriod(anchor: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  return { start, end };
}

export function parsePeriod(periodStart?: string, periodEnd?: string): { start: Date; end: Date } {
  const now = new Date();
  const start = periodStart ? new Date(periodStart) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = periodEnd ? new Date(periodEnd) : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestError("invalid period");
  if (end <= start) throw new BadRequestError("period_end must be after period_start");
  return { start, end };
}
