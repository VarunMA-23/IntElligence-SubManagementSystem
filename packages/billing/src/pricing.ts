import Decimal from "decimal.js";
import { BadRequestError, dec, money } from "@brightloop/shared";

export interface Tier {
  first_unit: number;
  rate: string;
  flat_fee?: string | null;
  flat_cap?: string | null;
}

export type Pricing =
  | { type: "FLAT"; rate: string }
  | { type: "PER_UNIT"; rate: string }
  | { type: "PACKAGE"; block_size: number; rate: string }
  | { type: "TIERED"; block_size?: number; tiers: Tier[] }
  | { type: "VOLUME"; block_size?: number; tiers: Tier[] };

export interface PricedAmount {
  amount: string;
  breakdown: Array<{ description: string; quantity: string; rate: string; amount: string }>;
}

export function validateTiers(tiers: Tier[]): void {
  if (!tiers.length) throw new BadRequestError("tiers must not be empty");
  let previous = -1;
  for (const tier of tiers) {
    if (tier.first_unit <= previous) {
      throw new BadRequestError("tier first_unit values must be strictly ascending");
    }
    previous = tier.first_unit;
  }
  if (tiers[0]!.first_unit > 1) {
    throw new BadRequestError("tiers must start at unit 0 or 1");
  }
}

function tierContains(tier: Tier, next: Tier | undefined, quantity: number): boolean {
  return quantity >= tier.first_unit && (next === undefined || quantity < next.first_unit);
}

export function calculateAmount(pricing: Pricing, rawQuantity: number | string): PricedAmount {
  const quantity = dec(rawQuantity);
  if (quantity.isNegative()) throw new BadRequestError("quantity must be non-negative");

  switch (pricing.type) {
    case "FLAT": {
      return {
        amount: money(pricing.rate),
        breakdown: [{ description: "Flat fee", quantity: "1", rate: pricing.rate, amount: money(pricing.rate) }],
      };
    }
    case "PER_UNIT": {
      const amount = quantity.mul(dec(pricing.rate));
      return {
        amount: money(amount),
        breakdown: [{ description: "Per unit", quantity: quantity.toString(), rate: pricing.rate, amount: money(amount) }],
      };
    }
    case "PACKAGE": {
      const blocks = quantity.isZero() ? new Decimal(0) : quantity.div(pricing.block_size).ceil();
      const amount = blocks.mul(dec(pricing.rate));
      return {
        amount: money(amount),
        breakdown: [
          {
            description: `Packages of ${pricing.block_size}`,
            quantity: blocks.toString(),
            rate: pricing.rate,
            amount: money(amount),
          },
        ],
      };
    }
    case "TIERED": {
      validateTiers(pricing.tiers);
      let total = new Decimal(0);
      const breakdown: PricedAmount["breakdown"] = [];
      for (let index = 0; index < pricing.tiers.length; index += 1) {
        const tier = pricing.tiers[index]!;
        const next = pricing.tiers[index + 1];
        const lower = new Decimal(tier.first_unit);
        const upper = next ? new Decimal(next.first_unit) : undefined;
        let units = quantity.minus(lower);
        if (upper) units = Decimal.min(units, upper.minus(lower));
        if (units.isNegative()) units = new Decimal(0);
        const amount = units.mul(dec(tier.rate)).plus(dec(tier.flat_fee ?? "0"));
        if (tier.flat_cap && amount.gt(dec(tier.flat_cap))) {
          total = total.plus(dec(tier.flat_cap));
          breakdown.push({
            description: `Tier from ${tier.first_unit} (capped)`,
            quantity: units.toString(),
            rate: tier.rate,
            amount: money(tier.flat_cap),
          });
        } else {
          total = total.plus(amount);
          breakdown.push({
            description: `Tier from ${tier.first_unit}`,
            quantity: units.toString(),
            rate: tier.rate,
            amount: money(amount),
          });
        }
      }
      return { amount: money(total), breakdown };
    }
    case "VOLUME": {
      validateTiers(pricing.tiers);
      let selected: Tier | undefined;
      for (let index = 0; index < pricing.tiers.length; index += 1) {
        const tier = pricing.tiers[index]!;
        const next = pricing.tiers[index + 1];
        if (tierContains(tier, next, quantity.toNumber())) selected = tier;
      }
      const tier = selected ?? pricing.tiers[pricing.tiers.length - 1]!;
      const amount = quantity.mul(dec(tier.rate)).plus(dec(tier.flat_fee ?? "0"));
      const capped = tier.flat_cap && amount.gt(dec(tier.flat_cap)) ? dec(tier.flat_cap) : amount;
      return {
        amount: money(capped),
        breakdown: [
          {
            description: `Volume tier from ${tier.first_unit}`,
            quantity: quantity.toString(),
            rate: tier.rate,
            amount: money(capped),
          },
        ],
      };
    }
    default:
      throw new BadRequestError("unsupported pricing model");
  }
}
