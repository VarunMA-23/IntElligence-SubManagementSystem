export type EntitlementScope = "PLAN" | "ADD_ON" | "PRODUCT";

export type ResetPeriod =
  | { type: "BILLING_CYCLE" }
  | { type: "CALENDAR"; unit: "DAY" | "WEEK" | "MONTH" | "YEAR" }
  | { type: "FIXED_WINDOW"; duration_days: number }
  | { type: "SLIDING_WINDOW"; duration_days: number }
  | { type: "NEVER" };

export type EntitlementValue =
  | { type: "BOOLEAN"; enabled: boolean }
  | { type: "METERED"; limit: number; reset_period: ResetPeriod };

export interface ResolvedEntitlementInput {
  featureId: string;
  featureCode: string;
  featureName: string;
  scope: EntitlementScope;
  scopeId: string;
  value: EntitlementValue;
}

export interface ResolvedEntitlement {
  feature_id: string;
  feature_code: string;
  feature_name: string;
  value: EntitlementValue;
  source: { type: EntitlementScope; id: string };
  usage?: { used: string; limit: string; period_start: string; period_end: string | null };
}

const SPECIFICITY: Record<EntitlementScope, number> = { PLAN: 1, PRODUCT: 2, ADD_ON: 3 };

export function resolveEntitlements(
  inputs: ResolvedEntitlementInput[],
  options: {
    subscriptionStatus?: string;
    usage?: Map<string, { used: string; periodStart: Date; periodEnd: Date | null }>;
    now?: Date;
  } = {},
): ResolvedEntitlement[] {
  if (
    options.subscriptionStatus &&
    (options.subscriptionStatus === "CANCELLED" || options.subscriptionStatus === "COMPLETED")
  ) {
    return [];
  }

  const sorted = [...inputs].sort((a, b) => SPECIFICITY[a.scope] - SPECIFICITY[b.scope]);
  const resolved = new Map<string, ResolvedEntitlement>();

  for (const input of sorted) {
    const existing = resolved.get(input.featureId);
    let value = input.value;
    if (existing?.value.type === "METERED" && value.type === "METERED") {
      const currentLimit = value.limit;
      const existingLimit = existing.value.limit;
      value = { ...value, limit: Math.max(currentLimit, existingLimit) };
    }
    const usage = options.usage?.get(input.featureId);
    resolved.set(input.featureId, {
      feature_id: input.featureId,
      feature_code: input.featureCode,
      feature_name: input.featureName,
      value,
      source: { type: input.scope, id: input.scopeId },
      ...(value.type === "METERED"
        ? {
            usage: {
              used: usage?.used ?? "0",
              limit: String(value.limit),
              period_start: (usage?.periodStart ?? new Date()).toISOString().slice(0, 10),
              period_end: usage?.periodEnd ? usage.periodEnd.toISOString().slice(0, 10) : null,
            },
          }
        : {}),
    });
  }

  return [...resolved.values()];
}

export function resetWindow(
  resetPeriod: ResetPeriod,
  now: Date = new Date(),
  billingAnchor?: Date,
): { start: Date; end: Date | null } {
  switch (resetPeriod.type) {
    case "BILLING_CYCLE": {
      const anchor = billingAnchor ?? now;
      const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      return { start, end };
    }
    case "CALENDAR": {
      if (resetPeriod.unit === "DAY") {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        return { start, end: new Date(start.getTime() + 86_400_000) };
      }
      if (resetPeriod.unit === "WEEK") {
        const day = now.getUTCDay();
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
        return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
      }
      if (resetPeriod.unit === "MONTH") {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { start, end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) };
      }
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { start, end: new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1)) };
    }
    case "FIXED_WINDOW":
    case "SLIDING_WINDOW": {
      const end = new Date(now);
      const start = new Date(now.getTime() - resetPeriod.duration_days * 86_400_000);
      return { start, end };
    }
    case "NEVER":
      return { start: new Date(0), end: null };
  }
}
