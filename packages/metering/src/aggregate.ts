import Decimal from "decimal.js";
import { BadRequestError, dec, money } from "@brightloop/shared";

export type Aggregation = "COUNT" | "LATEST" | "MAX" | "MIN" | "MEAN" | "SUM" | "COUNT_DISTINCT";

export interface MeterEvent {
  eventId: string;
  timestamp: Date;
  value: string | number;
  properties: Record<string, string>;
}

export interface AggregationResult {
  total: string;
  grouped: Array<{ dimensions: Record<string, string>; value: string }>;
}

export function extractValue(
  event: MeterEvent,
  aggregation: Aggregation,
  field: string | null | undefined,
): Decimal {
  if (aggregation === "COUNT") return new Decimal(1);
  if (!field) throw new BadRequestError(`field is required for ${aggregation}`);
  const raw = event.properties[field];
  if (raw === undefined) {
    if (aggregation === "COUNT_DISTINCT" || aggregation === "LATEST") return new Decimal(0);
    throw new BadRequestError(`property '${field}' is required for ${aggregation}`);
  }
  if (aggregation === "COUNT_DISTINCT" || aggregation === "LATEST") return new Decimal(0);
  const value = new Decimal(raw);
  if (!value.isFinite()) throw new BadRequestError(`property '${field}' must be numeric`);
  return value;
}

export function aggregate(
  events: MeterEvent[],
  aggregation: Aggregation,
  field?: string | null,
  segmentationKeys: string[] = [],
): AggregationResult {
  if (!events.length) return { total: "0", grouped: [] };

  const groups = new Map<string, MeterEvent[]>();
  for (const event of events) {
    const key =
      segmentationKeys.length === 0
        ? "__all__"
        : JSON.stringify(
            Object.fromEntries(segmentationKeys.map((seg) => [seg, event.properties[seg] ?? ""])),
          );
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  const grouped: AggregationResult["grouped"] = [];
  let total = new Decimal(0);

  for (const [key, list] of groups) {
    const value = aggregateGroup(list, aggregation, field);
    total = total.plus(value);
    grouped.push({
      dimensions: key === "__all__" ? {} : JSON.parse(key),
      value: money(value),
    });
  }

  return { total: money(total), grouped };
}

function aggregateGroup(events: MeterEvent[], aggregation: Aggregation, field?: string | null): Decimal {
  const sorted = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  switch (aggregation) {
    case "COUNT":
      return new Decimal(events.length);
    case "SUM":
      return events.reduce((acc, event) => acc.plus(extractValue(event, aggregation, field)), new Decimal(0));
    case "MEAN": {
      const total = events.reduce((acc, event) => acc.plus(extractValue(event, aggregation, field)), new Decimal(0));
      return total.div(events.length);
    }
    case "MAX":
      return Decimal.max(...events.map((event) => extractValue(event, aggregation, field)));
    case "MIN":
      return Decimal.min(...events.map((event) => extractValue(event, aggregation, field)));
    case "LATEST": {
      const latest = sorted[sorted.length - 1]!;
      const raw = field ? latest.properties[field] : undefined;
      if (raw === undefined) throw new BadRequestError(`property '${field}' is required for LATEST`);
      const parsed = new Decimal(raw);
      if (!parsed.isFinite()) throw new BadRequestError(`property '${field}' must be numeric`);
      return parsed;
    }
    case "COUNT_DISTINCT": {
      if (!field) throw new BadRequestError("field is required for COUNT_DISTINCT");
      return new Decimal(new Set(events.map((event) => event.properties[field] ?? "")).size);
    }
  }
}

export function withinIngestionWindow(timestamp: Date, allowBackfilling: boolean, now = new Date()): boolean {
  if (allowBackfilling) return true;
  const min = now.getTime() - 24 * 60 * 60 * 1000;
  const max = now.getTime() + 60 * 60 * 1000;
  return timestamp.getTime() >= min && timestamp.getTime() <= max;
}

export function numericProperty(properties: Record<string, string>, field: string): string | null {
  const raw = properties[field];
  if (raw === undefined) return null;
  try {
    const value = dec(raw);
    return value.isFinite() ? money(value) : null;
  } catch {
    return null;
  }
}
