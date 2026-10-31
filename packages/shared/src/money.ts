import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type DecimalLike = string | number | Decimal | { toString(): string };

export function dec(value: DecimalLike): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(typeof value === "object" ? value.toString() : value);
}

export function money(value: DecimalLike): string {
  const d = dec(value);
  const fixed = d.toFixed(4);
  return fixed.replace(/\.?0+$/, "") || "0";
}

export function toMinorUnits(value: DecimalLike, _currency = "USD"): number {
  return dec(value).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function fromMinorUnits(value: number | string, _currency = "USD"): string {
  return new Decimal(value).div(100).toFixed(2);
}

export function minorUnits(value: DecimalLike): string {
  return dec(value).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString();
}

export function sum(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, value) => acc.plus(dec(value)), new Decimal(0));
}

export function maxZero(value: DecimalLike): Decimal {
  const d = dec(value);
  return d.isNegative() ? new Decimal(0) : d;
}

export function percentageOf(value: DecimalLike, percentage: DecimalLike): Decimal {
  return dec(value).mul(dec(percentage)).div(100);
}

export function formatMoney(value: DecimalLike, currency = "USD"): string {
  const d = dec(value);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(d.toNumber());
  } catch {
    return `${currency} ${d.toFixed(2)}`;
  }
}
