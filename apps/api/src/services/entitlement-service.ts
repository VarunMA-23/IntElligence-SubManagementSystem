import { NotFoundError, type TenantContext } from "@brightloop/shared";
import {
  AddOn,
  Customer,
  Entitlement,
  Feature,
  PlanVersion,
  Product,
  Subscription,
  SubscriptionAddOn,
  SubscriptionComponent,
  PriceComponent,
} from "@brightloop/db";
import {
  resetWindow,
  resolveEntitlements,
  type EntitlementScope,
  type ResolvedEntitlement,
  type ResolvedEntitlementInput,
} from "@brightloop/billing";
import { featureLookup } from "../lib/domain.js";
import { usedForFeature } from "./metering-service.js";

export async function attachEntitlements(
  ctx: Pick<TenantContext, "tenantId">,
  inputs: Array<{ feature_id: string; value: any }>,
  scope: EntitlementScope,
  scopeId: string,
) {
  for (const input of inputs) {
    await featureLookup(ctx.tenantId, input.feature_id);
    await Entitlement.findOneAndUpdate(
      { tenantId: ctx.tenantId, featureId: input.feature_id, scope, scopeId },
      { $set: { value: input.value } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}

async function hydrate(tenantId: string, entitlements: any[]): Promise<ResolvedEntitlementInput[]> {
  if (!entitlements.length) return [];
  const features = await Feature.find({
    tenantId,
    _id: { $in: entitlements.map((entitlement) => entitlement.featureId) },
    archivedAt: null,
  });
  const featureMap = new Map(features.map((feature) => [String(feature._id), feature]));
  return entitlements
    .filter((entitlement) => featureMap.has(entitlement.featureId))
    .map((entitlement) => {
      const feature = featureMap.get(entitlement.featureId)!;
      return {
        featureId: entitlement.featureId,
        featureCode: feature.code,
        featureName: feature.name,
        scope: entitlement.scope as EntitlementScope,
        scopeId: entitlement.scopeId,
        value: entitlement.value,
      };
    });
}

export async function entitlementsForPlanVersion(tenantId: string, planVersionId: string) {
  const version = await PlanVersion.findOne({ _id: planVersionId, tenantId });
  if (!version) throw new NotFoundError("Plan version");
  const entitlements = await Entitlement.find({ tenantId, scope: "PLAN", scopeId: planVersionId });
  return hydrate(tenantId, entitlements);
}

export async function entitlementsForProduct(tenantId: string, productId: string) {
  const product = await Product.findOne({ _id: productId, tenantId });
  if (!product) throw new NotFoundError("Product");
  const entitlements = await Entitlement.find({ tenantId, scope: "PRODUCT", scopeId: productId });
  return hydrate(tenantId, entitlements);
}

export async function entitlementsForAddOn(tenantId: string, addOnId: string) {
  const addOn = await AddOn.findOne({ _id: addOnId, tenantId });
  if (!addOn) throw new NotFoundError("Add-on");
  const entitlements = await Entitlement.find({ tenantId, scope: "ADD_ON", scopeId: addOnId });
  return hydrate(tenantId, entitlements);
}

async function withUsage(
  tenantId: string,
  customerId: string,
  inputs: ResolvedEntitlementInput[],
  anchor?: Date,
): Promise<ResolvedEntitlement[]> {
  const usage = new Map<string, { used: string; periodStart: Date; periodEnd: Date | null }>();
  for (const input of inputs) {
    if (input.value.type !== "METERED") continue;
    const window = resetWindow(input.value.reset_period, new Date(), anchor);
    const used = await usedForFeature(tenantId, customerId, input.featureCode, window.start, window.end ?? new Date());
    usage.set(input.featureId, { used, periodStart: window.start, periodEnd: window.end });
  }
  return resolveEntitlements(inputs, { usage });
}

export async function effectiveEntitlementsForSubscription(tenantId: string, subscription: any) {
  const inputs: ResolvedEntitlementInput[] = [];
  inputs.push(...(await entitlementsForPlanVersion(tenantId, subscription.planVersionId)));

  const addOns = await SubscriptionAddOn.find({ tenantId, subscriptionId: String(subscription._id) });
  for (const subscriptionAddOn of addOns) {
    inputs.push(...(await entitlementsForAddOn(tenantId, subscriptionAddOn.addOnId)));
  }

  const components = await SubscriptionComponent.find({ tenantId, subscriptionId: String(subscription._id) });
  const priceComponents = await PriceComponent.find({
    tenantId,
    _id: { $in: components.map((component) => component.priceComponentId) },
    productId: { $ne: null },
  });
  for (const priceComponent of priceComponents) {
    if (priceComponent.productId) {
      inputs.push(...(await entitlementsForProduct(tenantId, priceComponent.productId)));
    }
  }

  if (subscription.status === "CANCELLED" || subscription.status === "COMPLETED") return [];
  return withUsage(
    tenantId,
    subscription.customerId,
    inputs,
    subscription.currentPeriodStart ? new Date(subscription.currentPeriodStart) : undefined,
  );
}

export async function effectiveEntitlementsForCustomer(tenantId: string, customerId: string) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) throw new NotFoundError("Customer");
  const subscription = await Subscription.findOne({
    tenantId,
    customerId,
    status: { $in: ["ACTIVE", "TRIAL_ACTIVE", "TRIAL_EXPIRED", "PAUSED", "SUSPENDED"] },
  }).sort({ createdAt: -1 });
  if (!subscription) return [];
  return effectiveEntitlementsForSubscription(tenantId, subscription);
}

export async function entitlementUsageForFeature(
  tenantId: string,
  customerId: string,
  featureCode: string,
  window: { start: Date; end: Date | null },
) {
  return usedForFeature(tenantId, customerId, featureCode, window.start, window.end ?? new Date());
}
