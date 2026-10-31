import type { ClientSession } from "mongoose";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Role,
} from "@brightloop/shared";
import {
  Counter,
  Customer,
  EntityActivity,
  InvoicingEntity,
  OutboxEvent,
  Plan,
  PriceComponent,
  PlanVersion,
  Product,
  BillableMetric,
  Feature,
  Subscription,
} from "@brightloop/db";

export async function emitEvent(
  ctx: Pick<TenantContext, "tenantId">,
  type: string,
  payload: unknown,
  session?: ClientSession,
) {
  const [event] = await OutboxEvent.create(
    [
      {
        tenantId: ctx.tenantId,
        type,
        payload,
        status: "PENDING",
        availableAt: new Date(),
      },
    ],
    session ? { session } : undefined,
  );
  return event;
}

export async function recordActivity(input: {
  tenantId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  diff?: unknown;
}) {
  await EntityActivity.create({
    tenantId: input.tenantId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorId: input.actorId,
    diff: input.diff ?? null,
  });
}

export async function defaultInvoicingEntity(tenantId: string) {
  const entity = await InvoicingEntity.findOne({ tenantId, isDefault: true });
  if (entity) return entity;
  return InvoicingEntity.findOne({ tenantId }).sort({ createdAt: 1 });
}

export async function resolveCustomer(tenantId: string, idOrAlias: string) {
  const customer = await Customer.findOne({
    tenantId,
    $or: [{ _id: idOrAlias }, { alias: idOrAlias }],
  });
  if (!customer) throw new NotFoundError("Customer");
  return customer;
}

export async function resolvePlan(tenantId: string, planId: string) {
  const plan = await Plan.findOne({ _id: planId, tenantId });
  if (!plan) throw new NotFoundError("Plan");
  return plan;
}

export async function resolveActivePlanVersion(tenantId: string, planId: string) {
  const plan = await resolvePlan(tenantId, planId);
  if (plan.archivedAt) throw new ConflictError("Plan is archived");
  if (!plan.currentVersionId) throw new ConflictError("Plan has not been published");
  if (plan.status !== "ACTIVE") throw new ConflictError("Plan is not active");
  const version = await PlanVersion.findOne({ _id: plan.currentVersionId, tenantId });
  if (!version) throw new NotFoundError("Plan version");
  return { plan, version };
}

export async function assertPlanReferences(tenantId: string, components: any[]) {
  for (const component of components) {
    if (component.product_id) {
      const product = await Product.findOne({ _id: component.product_id, tenantId });
      if (!product) throw new BadRequestError("product_id does not belong to this tenant");
      if (product.archivedAt) throw new ConflictError(`Product ${product.name} is archived`);
    }
    if (component.metric_id) {
      const metric = await BillableMetric.findOne({ _id: component.metric_id, tenantId });
      if (!metric) throw new BadRequestError("metric_id does not belong to this tenant");
      if (metric.archivedAt) throw new ConflictError(`Metric ${metric.name} is archived`);
    }
    if (component.fee_type === "USAGE" && !component.metric_id) {
      throw new BadRequestError("USAGE components require metric_id");
    }
  }
}

export async function assertPublishedPlanReference(
  tenantId: string,
  reference: { productId?: string | null; metricId?: string | null },
) {
  const versions = await PlanVersion.find({ tenantId }).select("_id planId");
  if (!versions.length) return;
  const versionIds = versions.map((version) => version._id);
  const filter: Record<string, unknown> = { tenantId, planVersionId: { $in: versionIds } };
  if (reference.productId) filter.productId = reference.productId;
  if (reference.metricId) filter.metricId = reference.metricId;
  const component = await PriceComponent.findOne(filter);
  if (component) {
    const plan = await Plan.findById(versions.find((v) => v._id === component.planVersionId)?.planId).select("name");
    throw new ConflictError(`Entity is referenced by published plan ${plan?.name ?? ""}`.trim());
  }
}

export async function nextSequence(tenantId: string, prefix: string, at = new Date()) {
  const year = at.getUTCFullYear();
  const key = `${tenantId}:${prefix}:${year}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return `${prefix}-${year}-${String(counter!.value).padStart(6, "0")}`;
}

export async function activeSubscriptionsForCustomer(tenantId: string, customerId: string) {
  return Subscription.find({
    tenantId,
    customerId,
    status: { $in: ["ACTIVE", "TRIAL_ACTIVE", "TRIAL_EXPIRED", "PENDING_ACTIVATION", "PAUSED", "SUSPENDED"] },
  }).sort({ createdAt: -1 });
}

export async function featureLookup(tenantId: string, featureId: string) {
  const feature = await Feature.findOne({ _id: featureId, tenantId });
  if (!feature) throw new BadRequestError("feature_id does not belong to this tenant");
  if (feature.archivedAt) throw new ConflictError("Feature is archived");
  return feature;
}

export function assertRoleCanWrite(role: Role) {
  if (role === "viewer") throw new ConflictError("viewers cannot modify resources");
}
