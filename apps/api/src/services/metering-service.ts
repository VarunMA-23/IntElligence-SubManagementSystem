import Decimal from "decimal.js";
import {
  BadRequestError,
  NotFoundError,
  dec,
  money,
  type TenantContext,
} from "@brightloop/shared";
import {
  BillableMetric,
  Customer,
  EventKey,
  PlanVersion,
  PriceComponent,
  Subscription,
  UsageEvent,
} from "@brightloop/db";
import { aggregate, withinIngestionWindow, type MeterEvent } from "@brightloop/metering";
import { emitEvent } from "../lib/domain.js";
import { decimalString } from "../lib/serializers.js";
import { withTransaction } from "../lib/transaction.js";

export interface IngestInput {
  events: Array<{
    event_id: string;
    code: string;
    customer_id: string;
    timestamp: string;
    properties: Record<string, string>;
  }>;
  allow_backfilling: boolean;
  allow_partial_failures: boolean;
}

export interface IngestResult {
  ingested: number;
  duplicates: number;
  failed: number;
  failures: Array<{ index: number; event_id: string; error: string }>;
}

export async function ingestEvents(ctx: TenantContext, input: IngestInput): Promise<IngestResult> {
  if (!input.events.length) throw new BadRequestError("events must not be empty");
  if (input.events.length > 100) throw new BadRequestError("at most 100 events per batch");

  const customerCache = new Map<string, any>();
  const metricCache = new Map<string, any>();
  const failures: Array<{ index: number; event_id: string; error: string }> = [];
  const prepared: Array<{
    index: number;
    eventId: string;
    customerId: string;
    metricCode: string;
    metric: any;
    timestamp: Date;
    value: string;
    properties: Record<string, string>;
  }> = [];

  for (let index = 0; index < input.events.length; index += 1) {
    const event = input.events[index]!;
    try {
      let customer = customerCache.get(event.customer_id);
      if (!customer) {
        customer = await Customer.findOne({
          tenantId: ctx.tenantId,
          $or: [{ _id: event.customer_id }, { alias: event.customer_id }],
        });
        if (!customer) throw new NotFoundError("Customer");
        customerCache.set(event.customer_id, customer);
      }
      let metric = metricCache.get(event.code);
      if (!metric) {
        metric = await BillableMetric.findOne({ tenantId: ctx.tenantId, code: event.code });
        if (!metric) throw new NotFoundError("Metric");
        if (metric.archivedAt) throw new BadRequestError("metric is archived");
        metricCache.set(event.code, metric);
      }
      const timestamp = new Date(event.timestamp);
      if (Number.isNaN(timestamp.getTime())) throw new BadRequestError("timestamp is invalid");
      if (!withinIngestionWindow(timestamp, input.allow_backfilling)) {
        throw new BadRequestError("timestamp is outside the allowed ingestion window");
      }
      let value = "1";
      if (metric.aggregation !== "COUNT" && metric.aggregation !== "COUNT_DISTINCT" && metric.aggregation !== "LATEST") {
        const field = metric.field as string;
        const raw = event.properties[field];
        if (raw === undefined) throw new BadRequestError(`property '${field}' is required`);
        if (!dec(raw).isFinite()) throw new BadRequestError(`property '${field}' must be numeric`);
        value = money(raw);
      } else if (metric.aggregation === "LATEST" && metric.field) {
        const raw = event.properties[metric.field];
        if (raw !== undefined) value = money(raw);
      }
      prepared.push({
        index,
        eventId: event.event_id,
        customerId: String(customer._id),
        metricCode: metric.code,
        metric,
        timestamp,
        value,
        properties: event.properties,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid event";
      failures.push({ index, event_id: event.event_id, error: message });
      if (!input.allow_partial_failures) {
        throw new BadRequestError(`event ${index} is invalid: ${message}`);
      }
    }
  }

  if (!prepared.length) {
    return { ingested: 0, duplicates: 0, failed: failures.length, failures };
  }

  const result = await withTransaction(async (session) => {
    let ingested = 0;
    let duplicates = 0;
    for (const item of prepared) {
      const existing = await EventKey.findOne(
        { tenantId: ctx.tenantId, customerId: item.customerId, eventId: item.eventId },
        null,
        session ? { session } : undefined,
      );
      if (existing) {
        duplicates += 1;
        continue;
      }
      try {
        await EventKey.create(
          [
            {
              tenantId: ctx.tenantId,
              customerId: item.customerId,
              eventId: item.eventId,
              timestamp: item.timestamp,
            },
          ],
          session ? { session } : undefined,
        );
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          duplicates += 1;
          continue;
        }
        throw error;
      }
      await UsageEvent.collection.insertOne(
        {
          eventId: item.eventId,
          timestamp: item.timestamp,
          value: item.value,
          properties: item.properties,
          meta: {
            tenantId: ctx.tenantId,
            customerId: item.customerId,
            metricCode: item.metricCode,
          },
          ingestedAt: new Date(),
        },
        session ? { session } : undefined,
      );
      ingested += 1;
    }
    if (ingested > 0) {
      await emitEvent(ctx, "event.ingested", { ingested, duplicates }, session);
    }
    return { ingested, duplicates };
  });

  return { ...result, failed: failures.length, failures };
}

export async function loadEvents(
  tenantId: string,
  customerId: string,
  metricCode: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<MeterEvent[]> {
  const events = await UsageEvent.find({
    "meta.tenantId": tenantId,
    "meta.customerId": customerId,
    "meta.metricCode": metricCode,
    timestamp: { $gte: periodStart, $lt: periodEnd },
  })
    .sort({ timestamp: 1 })
    .lean();
  return events.map((event: any) => ({
    eventId: event.eventId,
    timestamp: event.timestamp,
    value: decimalString(event.value),
    properties: event.properties ?? {},
  }));
}

export async function computeMetricUsage(input: {
  tenantId: string;
  customerId: string;
  metric: any;
  periodStart: Date;
  periodEnd: Date;
}) {
  const events = await loadEvents(
    input.tenantId,
    input.customerId,
    input.metric.code,
    input.periodStart,
    input.periodEnd,
  );
  return aggregate(events, input.metric.aggregation, input.metric.field, input.metric.segmentationKeys ?? []);
}

export async function metricUsageForSubscription(subscription: any) {
  const components = await PriceComponent.find({
    tenantId: subscription.tenantId,
    planVersionId: subscription.planVersionId,
    metricId: { $ne: null },
  });
  const metrics = await BillableMetric.find({
    tenantId: subscription.tenantId,
    _id: { $in: components.map((component) => component.metricId) },
  });
  return { components, metrics };
}

export async function usageForCustomer(tenantId: string, customerId: string, periodStart: Date, periodEnd: Date, metricCode?: string) {
  const filter: Record<string, unknown> = { tenantId, archivedAt: null };
  if (metricCode) filter.code = metricCode;
  const metrics = await BillableMetric.find(filter).sort({ createdAt: 1 });
  const usage = [];
  for (const metric of metrics) {
    const result = await computeMetricUsage({ tenantId, customerId, metric, periodStart, periodEnd });
    usage.push({
      metric_id: String(metric._id),
      metric_name: metric.name,
      metric_code: metric.code,
      total_value: result.total,
      grouped_usage: result.grouped,
    });
  }
  return usage;
}

export async function usageForTenant(tenantId: string, periodStart: Date, periodEnd: Date) {
  const metrics = await BillableMetric.find({ tenantId, archivedAt: null }).sort({ createdAt: 1 });
  const customers = await Customer.find({ tenantId }).select("_id").lean();
  const usage = [];
  for (const metric of metrics) {
    let total = new Decimal(0);
    const grouped: Array<{ dimensions: Record<string, string>; value: string }> = [];
    for (const customer of customers) {
      const result = await computeMetricUsage({
        tenantId,
        customerId: String(customer._id),
        metric,
        periodStart,
        periodEnd,
      });
      total = total.plus(dec(result.total));
      grouped.push(...result.grouped);
    }
    usage.push({
      metric_id: String(metric._id),
      metric_name: metric.name,
      metric_code: metric.code,
      total_value: money(total),
      grouped_usage: grouped,
    });
  }
  return usage;
}

export async function usedForFeature(
  tenantId: string,
  customerId: string,
  featureCode: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<string> {
  const metric = await BillableMetric.findOne({ tenantId, code: featureCode });
  if (!metric) return "0";
  const result = await computeMetricUsage({ tenantId, customerId, metric, periodStart, periodEnd });
  return result.total;
}

export async function subscriptionForUsage(tenantId: string, subscriptionId: string) {
  const subscription = await Subscription.findOne({ _id: subscriptionId, tenantId });
  if (!subscription) throw new NotFoundError("Subscription");
  const version = await PlanVersion.findOne({ _id: subscription.planVersionId, tenantId });
  return { subscription, version };
}
