import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  type TenantContext,
} from "@brightloop/shared";
import { Plan, PlanVersion, PriceComponent, ProductFamily, Subscription } from "@brightloop/db";
import { validateTiers } from "@brightloop/billing";
import {
  assertPlanReferences,
  emitEvent,
  recordActivity,
} from "../lib/domain.js";
import { attachEntitlements } from "./entitlement-service.js";
import { withTransaction } from "../lib/transaction.js";

function validateComponentPricing(components: any[]) {
  if (!components.length) throw new BadRequestError("a plan requires at least one component");
  for (const component of components) {
    if (component.pricing?.type === "TIERED" || component.pricing?.type === "VOLUME") {
      validateTiers(
        (component.pricing.tiers ?? []).map((tier: any) => ({
          first_unit: tier.first_unit,
          rate: tier.rate,
          flat_fee: tier.flat_fee,
          flat_cap: tier.flat_cap,
        })),
      );
    }
    if (component.pricing?.type === "PACKAGE" && !component.pricing.block_size) {
      throw new BadRequestError("PACKAGE pricing requires block_size");
    }
  }
}

export async function createPlan(ctx: TenantContext, input: any) {
  const family = await ProductFamily.findOne({ _id: input.product_family_id, tenantId: ctx.tenantId });
  if (!family) throw new BadRequestError("product_family_id does not belong to this tenant");
  validateComponentPricing(input.components);
  await assertPlanReferences(ctx.tenantId, input.components);
  const plan = await Plan.create({
    tenantId: ctx.tenantId,
    name: input.name,
    alias: input.alias,
    description: input.description ?? null,
    planType: input.plan_type,
    status: "DRAFT",
    productFamilyId: input.product_family_id,
    currency: input.currency,
    billingPeriod: input.billing_period,
    billingType: input.billing_type,
    netTerms: input.net_terms,
    trialDays: input.trial_days,
    selfServiceRank: input.self_service_rank ?? null,
    draftComponents: input.components,
    draftEntitlements: input.entitlements ?? [],
  });
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "plan",
    entityId: String(plan._id),
    action: "created",
    actorId: ctx.actorId,
    diff: { name: plan.name, alias: plan.alias },
  });
  return plan;
}

export async function updatePlan(ctx: TenantContext, planId: string, input: any) {
  const plan = await Plan.findOne({ _id: planId, tenantId: ctx.tenantId });
  if (!plan) throw new NotFoundError("Plan");
  if (plan.archivedAt) throw new ConflictError("Plan is archived");
  if (input.components) {
    validateComponentPricing(input.components);
    await assertPlanReferences(ctx.tenantId, input.components);
    plan.draftComponents = input.components;
  }
  if (input.entitlements) plan.draftEntitlements = input.entitlements;
  if (input.name !== undefined) plan.name = input.name;
  if (input.description !== undefined) plan.description = input.description;
  if (input.plan_type !== undefined) plan.planType = input.plan_type;
  if (input.self_service_rank !== undefined) plan.selfServiceRank = input.self_service_rank;
  plan.updatedAt = new Date();
  await plan.save();
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "plan",
    entityId: planId,
    action: "updated",
    actorId: ctx.actorId,
    diff: input,
  });
  return plan;
}

export async function publishPlan(ctx: TenantContext, planId: string, input: any) {
  const plan = await Plan.findOne({ _id: planId, tenantId: ctx.tenantId });
  if (!plan) throw new NotFoundError("Plan");
  if (plan.archivedAt) throw new ConflictError("Plan is archived");
  const components = input.components ?? plan.draftComponents;
  const entitlements = input.entitlements ?? plan.draftEntitlements;
  validateComponentPricing(components);
  await assertPlanReferences(ctx.tenantId, components);

  const version = await withTransaction(async (session) => {
    const latest = await PlanVersion.findOne({ tenantId: ctx.tenantId, planId }).sort({ version: -1 });
    const nextVersion = (latest?.version ?? 0) + 1;
    const [created] = await PlanVersion.create(
      [
        {
          tenantId: ctx.tenantId,
          planId,
          version: nextVersion,
          currency: plan.currency,
          billingPeriod: plan.billingPeriod,
          billingType: plan.billingType,
          netTerms: plan.netTerms,
          trialDays: input.trial_days ?? plan.trialDays,
          publishedAt: new Date(),
        },
      ],
      session ? { session } : undefined,
    );
    const componentDocs = components.map((component: any, index: number) => ({
      tenantId: ctx.tenantId,
      planVersionId: String(created._id),
      productId: component.product_id ?? null,
      metricId: component.metric_id ?? null,
      name: component.name,
      feeType: component.fee_type,
      billingPeriod: component.billing_period,
      billingType: component.billing_type,
      pricing: component.pricing,
      order: component.order ?? index,
    }));
    await PriceComponent.create(componentDocs as any, session ? { session } : undefined);
    plan.currentVersionId = String(created._id);
    plan.status = "ACTIVE";
    plan.updatedAt = new Date();
    if (input.components) plan.draftComponents = input.components;
    if (input.entitlements) plan.draftEntitlements = input.entitlements;
    await plan.save(session ? { session } : undefined);
    await emitEvent(
      ctx,
      "plan.published",
      { planId, planVersionId: String(created._id), version: nextVersion },
      session,
    );
    return created;
  });

  await attachEntitlements(ctx, entitlements, "PLAN", String(version._id));
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "plan",
    entityId: planId,
    action: "published",
    actorId: ctx.actorId,
    diff: { version: version.version },
  });
  return version;
}

export async function archivePlan(ctx: TenantContext, planId: string) {
  const plan = await Plan.findOne({ _id: planId, tenantId: ctx.tenantId });
  if (!plan) throw new NotFoundError("Plan");
  const active = await Subscription.countDocuments({
    tenantId: ctx.tenantId,
    planId,
    status: { $in: ["ACTIVE", "TRIAL_ACTIVE", "PENDING_ACTIVATION", "PAUSED", "SUSPENDED"] },
  });
  if (active) throw new ConflictError("Plan has active subscriptions");
  plan.status = "ARCHIVED";
  plan.archivedAt = plan.archivedAt ?? new Date();
  plan.updatedAt = new Date();
  await plan.save();
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "plan",
    entityId: planId,
    action: "archived",
    actorId: ctx.actorId,
  });
  return plan;
}

export async function listPlanVersions(tenantId: string, planId: string) {
  const plan = await Plan.findOne({ _id: planId, tenantId });
  if (!plan) throw new NotFoundError("Plan");
  return PlanVersion.find({ tenantId, planId }).sort({ version: 1 });
}

export async function planWithVersion(tenantId: string, planId: string) {
  const plan = await Plan.findOne({ _id: planId, tenantId });
  if (!plan) throw new NotFoundError("Plan");
  const version = plan.currentVersionId
    ? await PlanVersion.findOne({ _id: plan.currentVersionId, tenantId })
    : null;
  const components = version
    ? await PriceComponent.find({ tenantId, planVersionId: String(version._id) }).sort({ order: 1 })
    : [];
  return { plan, version, components };
}
