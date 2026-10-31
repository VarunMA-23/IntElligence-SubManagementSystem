import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  type TenantContext,
} from "@brightloop/shared";
import {
  AddOn,
  BillableMetric,
  Coupon,
  Entitlement,
  Feature,
  Plan,
  PlanVersion,
  PriceComponent,
  Product,
  ProductFamily,
} from "@brightloop/db";
import { attachEntitlements } from "./entitlement-service.js";
import { assertPublishedPlanReference, emitEvent, recordActivity } from "../lib/domain.js";
import { escapeRegex } from "../lib/http.js";

async function assertUnique(tenantId: string, model: any, alias: string, id?: string) {
  const filter: Record<string, unknown> = { tenantId, alias };
  if (id) filter._id = { $ne: id };
  if (await model.findOne(filter)) throw new ConflictError("Alias is already in use");
}

export async function createFamily(ctx: TenantContext, input: any) {
  await assertUnique(ctx.tenantId, ProductFamily, input.alias);
  return ProductFamily.create({ tenantId: ctx.tenantId, name: input.name, alias: input.alias });
}

export async function updateFamily(ctx: TenantContext, id: string, input: any) {
  const family = await ProductFamily.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!family) throw new NotFoundError("Product family");
  if (family.archivedAt) throw new ConflictError("Product family is archived");
  if (input.alias) await assertUnique(ctx.tenantId, ProductFamily, input.alias, id);
  if (input.name) family.name = input.name;
  if (input.alias) family.alias = input.alias;
  await family.save();
  return family;
}

export async function archiveFamily(ctx: TenantContext, id: string) {
  const family = await ProductFamily.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!family) throw new NotFoundError("Product family");
  const products = await Product.countDocuments({ tenantId: ctx.tenantId, familyId: id, archivedAt: null });
  if (products) throw new ConflictError("Archive the family's products first");
  family.archivedAt = family.archivedAt ?? new Date();
  await family.save();
  return family;
}

export async function createProduct(ctx: TenantContext, input: any) {
  const family = await ProductFamily.findOne({ _id: input.family_id, tenantId: ctx.tenantId });
  if (!family || family.archivedAt) throw new BadRequestError("family_id is invalid or archived");
  await assertUnique(ctx.tenantId, Product, input.alias);
  const product = await Product.create({
    tenantId: ctx.tenantId,
    familyId: input.family_id,
    name: input.name,
    alias: input.alias,
    description: input.description ?? null,
    feeType: input.fee_type,
  });
  if (input.entitlements?.length) {
    await attachEntitlements(ctx, input.entitlements, "PRODUCT", String(product._id));
  }
  return product;
}

export async function updateProduct(ctx: TenantContext, id: string, input: any) {
  const product = await Product.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!product) throw new NotFoundError("Product");
  if (product.archivedAt) throw new ConflictError("Product is archived");
  if (input.family_id) {
    const family = await ProductFamily.findOne({ _id: input.family_id, tenantId: ctx.tenantId });
    if (!family || family.archivedAt) throw new BadRequestError("family_id is invalid or archived");
    product.familyId = input.family_id;
  }
  if (input.name !== undefined) product.name = input.name;
  if (input.description !== undefined) product.description = input.description;
  if (input.fee_type !== undefined) product.feeType = input.fee_type;
  await product.save();
  return product;
}

export async function archiveProduct(ctx: TenantContext, id: string) {
  const product = await Product.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!product) throw new NotFoundError("Product");
  const published = await PriceComponent.findOne({
    tenantId: ctx.tenantId,
    productId: id,
    planVersionId: { $in: (await PlanVersion.find({ tenantId: ctx.tenantId }).select("_id")).map((v) => String(v._id)) },
  });
  if (published) throw new ConflictError("Product is referenced by a published plan version");
  product.archivedAt = product.archivedAt ?? new Date();
  await product.save();
  return product;
}

export async function createFeature(ctx: TenantContext, input: any) {
  const existing = await Feature.findOne({ tenantId: ctx.tenantId, code: input.code });
  if (existing) throw new ConflictError("Feature code is already in use");
  return Feature.create({
    tenantId: ctx.tenantId,
    name: input.name,
    code: input.code,
    featureType: input.feature_type,
  });
}

export async function archiveFeature(ctx: TenantContext, id: string) {
  const feature = await Feature.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!feature) throw new NotFoundError("Feature");
  feature.archivedAt = feature.archivedAt ?? new Date();
  await feature.save();
  await Entitlement.deleteMany({ tenantId: ctx.tenantId, featureId: id });
  return feature;
}

export async function createMetric(ctx: TenantContext, input: any) {
  const existing = await BillableMetric.findOne({ tenantId: ctx.tenantId, code: input.code });
  if (existing) throw new ConflictError("Metric code is already in use");
  return BillableMetric.create({
    tenantId: ctx.tenantId,
    name: input.name,
    code: input.code,
    aggregation: input.aggregation,
    field: input.field ?? null,
    segmentationKeys: input.segmentation_keys ?? [],
  });
}

export async function updateMetric(ctx: TenantContext, id: string, input: any) {
  const metric = await BillableMetric.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!metric) throw new NotFoundError("Metric");
  if (metric.archivedAt) throw new ConflictError("Metric is archived");
  if (input.name !== undefined) metric.name = input.name;
  if (input.aggregation !== undefined) metric.aggregation = input.aggregation;
  if (input.field !== undefined) metric.field = input.field;
  if (input.segmentation_keys !== undefined) metric.segmentationKeys = input.segmentation_keys;
  if (metric.aggregation !== "COUNT" && !metric.field) {
    throw new BadRequestError("field is required for this aggregation");
  }
  await metric.save();
  return metric;
}

export async function archiveMetric(ctx: TenantContext, id: string) {
  const metric = await BillableMetric.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!metric) throw new NotFoundError("Metric");
  await assertPublishedPlanReference(ctx.tenantId, { metricId: id });
  metric.archivedAt = metric.archivedAt ?? new Date();
  await metric.save();
  return metric;
}

export async function listFamily(tenantId: string) {
  return ProductFamily.find({ tenantId, archivedAt: null }).sort({ createdAt: -1 });
}

export async function listProducts(
  tenantId: string,
  query: { page: number; per_page: number; search?: string; archived: boolean; family_id?: string },
) {
  const filter: Record<string, unknown> = {
    tenantId,
    archivedAt: query.archived ? { $ne: null } : null,
  };
  if (query.family_id) filter.familyId = query.family_id;
  if (query.search) filter.name = new RegExp(escapeRegex(query.search), "i");
  const [data, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1 })
      .skip(query.page * query.per_page)
      .limit(query.per_page),
    Product.countDocuments(filter),
  ]);
  return { data, total };
}

export async function createAddOn(ctx: TenantContext, input: any) {
  const product = await Product.findOne({ _id: input.product_id, tenantId: ctx.tenantId });
  if (!product || product.archivedAt) throw new BadRequestError("product_id is invalid or archived");
  await assertUnique(ctx.tenantId, AddOn, input.alias);
  const addOn = await AddOn.create({
    tenantId: ctx.tenantId,
    name: input.name,
    alias: input.alias,
    productId: input.product_id,
    description: input.description ?? null,
    feeType: input.fee_type ?? null,
    selfServiceable: input.self_serviceable,
    maxInstancesPerSubscription: input.max_instances_per_subscription ?? null,
    pricing: input.pricing,
    entitlements: input.entitlements ?? [],
  });
  if (input.entitlements?.length) {
    await attachEntitlements(ctx, input.entitlements, "ADD_ON", String(addOn._id));
  }
  return addOn;
}

export async function updateAddOn(ctx: TenantContext, id: string, input: any) {
  const addOn = await AddOn.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!addOn) throw new NotFoundError("Add-on");
  if (addOn.archivedAt) throw new ConflictError("Add-on is archived");
  if (input.name !== undefined) addOn.name = input.name;
  if (input.description !== undefined) addOn.description = input.description;
  if (input.self_serviceable !== undefined) addOn.selfServiceable = input.self_serviceable;
  if (input.max_instances_per_subscription !== undefined) {
    addOn.maxInstancesPerSubscription = input.max_instances_per_subscription;
  }
  if (input.pricing !== undefined) addOn.pricing = input.pricing;
  await addOn.save();
  return addOn;
}

export async function archiveAddOn(ctx: TenantContext, id: string) {
  const addOn = await AddOn.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!addOn) throw new NotFoundError("Add-on");
  addOn.archivedAt = addOn.archivedAt ?? new Date();
  await addOn.save();
  return addOn;
}

export async function createCoupon(ctx: TenantContext, input: any) {
  const existing = await Coupon.findOne({ tenantId: ctx.tenantId, code: input.code });
  if (existing) throw new ConflictError("Coupon code is already in use");
  if (input.plan_ids?.length) {
    const count = await Plan.countDocuments({ tenantId: ctx.tenantId, _id: { $in: input.plan_ids } });
    if (count !== input.plan_ids.length) throw new BadRequestError("one or more plan_ids are invalid");
  }
  return Coupon.create({
    tenantId: ctx.tenantId,
    code: input.code,
    description: input.description ?? null,
    discount: input.discount,
    reusable: input.reusable,
    redemptionLimit: input.redemption_limit ?? null,
    recurringValue: input.recurring_value ?? null,
    expiresAt: input.expires_at ? new Date(input.expires_at) : null,
    planIds: input.plan_ids ?? [],
  });
}

export async function updateCoupon(ctx: TenantContext, id: string, input: any) {
  const coupon = await Coupon.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!coupon) throw new NotFoundError("Coupon");
  if (coupon.archivedAt) throw new ConflictError("Coupon is archived");
  Object.assign(coupon, {
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.reusable !== undefined ? { reusable: input.reusable } : {}),
    ...(input.redemption_limit !== undefined ? { redemptionLimit: input.redemption_limit } : {}),
    ...(input.recurring_value !== undefined ? { recurringValue: input.recurring_value } : {}),
    ...(input.expires_at !== undefined ? { expiresAt: input.expires_at ? new Date(input.expires_at) : null } : {}),
    ...(input.plan_ids !== undefined ? { planIds: input.plan_ids } : {}),
  });
  await coupon.save();
  return coupon;
}

export async function archiveCoupon(ctx: TenantContext, id: string) {
  const coupon = await Coupon.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!coupon) throw new NotFoundError("Coupon");
  coupon.archivedAt = coupon.archivedAt ?? new Date();
  await coupon.save();
  return coupon;
}

export async function catalogLookups(tenantId: string) {
  const [families, products, features, metrics] = await Promise.all([
    ProductFamily.find({ tenantId, archivedAt: null }),
    Product.find({ tenantId, archivedAt: null }),
    Feature.find({ tenantId, archivedAt: null }),
    BillableMetric.find({ tenantId, archivedAt: null }),
  ]);
  return { families, products, features, metrics };
}

void emitEvent;
void recordActivity;
