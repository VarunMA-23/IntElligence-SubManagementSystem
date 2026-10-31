import { Router } from "express";
import {
  ForbiddenError,
  addOnListQuerySchema,
  catalogListQuerySchema,
  couponListQuerySchema,
  createAddOnSchema,
  createCouponSchema,
  createFeatureSchema,
  createMetricSchema,
  createProductFamilySchema,
  createProductSchema,
  updateAddOnSchema,
  updateCouponSchema,
  updateMetricSchema,
  updateProductFamilySchema,
  updateProductSchema,
} from "@brightloop/shared";
import { AddOn, BillableMetric, Coupon, Feature, Product, ProductFamily } from "@brightloop/db";
import { asyncHandler, pageMeta } from "../lib/http.js";
import {
  serializeAddOn,
  serializeCoupon,
  serializeFamily,
  serializeFeature,
  serializeMetric,
  serializeProduct,
} from "../lib/serializers.js";
import { requireMinRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  archiveAddOn,
  archiveCoupon,
  archiveFamily,
  archiveFeature,
  archiveMetric,
  archiveProduct,
  createAddOn,
  createCoupon,
  createFamily,
  createFeature,
  createMetric,
  createProduct,
  listFamily,
  listProducts,
  updateAddOn,
  updateCoupon,
  updateFamily,
  updateMetric,
  updateProduct,
} from "../services/catalog-service.js";

export function catalogRoutes() {
  const router = Router();

  router.get(
    "/product-families",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json({ data: (await listFamily(req.tenant.tenantId)).map(serializeFamily) });
    }),
  );

  router.post(
    "/product-families",
    requireMinRole("member"),
    validate({ body: createProductFamilySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const family = await createFamily(req.tenant, req.body);
      res.status(201).json(serializeFamily(family));
    }),
  );

  router.patch(
    "/product-families/:id",
    requireMinRole("member"),
    validate({ body: updateProductFamilySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeFamily(await updateFamily(req.tenant, req.params.id, req.body)));
    }),
  );

  router.delete(
    "/product-families/:id",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeFamily(await archiveFamily(req.tenant, req.params.id)));
    }),
  );

  router.get(
    "/products",
    validate({ query: catalogListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const result = await listProducts(req.tenant.tenantId, query);
      res.json({
        data: result.data.map(serializeProduct),
        meta: pageMeta(query.page, query.per_page, result.total),
      });
    }),
  );

  router.post(
    "/products",
    requireMinRole("member"),
    validate({ body: createProductSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.status(201).json(serializeProduct(await createProduct(req.tenant, req.body)));
    }),
  );

  router.get(
    "/products/:id",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const product = await Product.findOne({ _id: req.params.id, tenantId: req.tenant.tenantId });
      if (!product) throw new ForbiddenError("Product not found");
      res.json(serializeProduct(product));
    }),
  );

  router.patch(
    "/products/:id",
    requireMinRole("member"),
    validate({ body: updateProductSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeProduct(await updateProduct(req.tenant, req.params.id, req.body)));
    }),
  );

  router.delete(
    "/products/:id",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeProduct(await archiveProduct(req.tenant, req.params.id)));
    }),
  );

  router.get(
    "/features",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const features = await Feature.find({ tenantId: req.tenant.tenantId, archivedAt: null }).sort({
        createdAt: -1,
      });
      res.json({ data: features.map(serializeFeature) });
    }),
  );

  router.post(
    "/features",
    requireMinRole("member"),
    validate({ body: createFeatureSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.status(201).json(serializeFeature(await createFeature(req.tenant, req.body)));
    }),
  );

  router.delete(
    "/features/:id",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeFeature(await archiveFeature(req.tenant, req.params.id)));
    }),
  );

  router.get(
    "/metrics",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const metrics = await BillableMetric.find({ tenantId: req.tenant.tenantId, archivedAt: null }).sort({
        createdAt: -1,
      });
      res.json({ data: metrics.map(serializeMetric) });
    }),
  );

  router.post(
    "/metrics",
    requireMinRole("member"),
    validate({ body: createMetricSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.status(201).json(serializeMetric(await createMetric(req.tenant, req.body)));
    }),
  );

  router.patch(
    "/metrics/:id",
    requireMinRole("member"),
    validate({ body: updateMetricSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeMetric(await updateMetric(req.tenant, req.params.id, req.body)));
    }),
  );

  router.delete(
    "/metrics/:id",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeMetric(await archiveMetric(req.tenant, req.params.id)));
    }),
  );

  router.get(
    "/add-ons",
    validate({ query: addOnListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const filter = {
        tenantId: req.tenant.tenantId,
        ...(query.archived ? { archivedAt: { $ne: null } } : { archivedAt: null }),
      };
      const [data, total] = await Promise.all([
        AddOn.find(filter)
          .sort({ createdAt: -1 })
          .skip(query.page * query.per_page)
          .limit(query.per_page),
        AddOn.countDocuments(filter),
      ]);
      res.json({ data: data.map(serializeAddOn), meta: pageMeta(query.page, query.per_page, total) });
    }),
  );

  router.post(
    "/add-ons",
    requireMinRole("member"),
    validate({ body: createAddOnSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.status(201).json(serializeAddOn(await createAddOn(req.tenant, req.body)));
    }),
  );

  router.patch(
    "/add-ons/:id",
    requireMinRole("member"),
    validate({ body: updateAddOnSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeAddOn(await updateAddOn(req.tenant, req.params.id, req.body)));
    }),
  );

  router.delete(
    "/add-ons/:id",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeAddOn(await archiveAddOn(req.tenant, req.params.id)));
    }),
  );

  router.get(
    "/coupons",
    validate({ query: couponListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const filter = {
        tenantId: req.tenant.tenantId,
        ...(query.archived ? { archivedAt: { $ne: null } } : { archivedAt: null }),
      };
      const [data, total] = await Promise.all([
        Coupon.find(filter)
          .sort({ createdAt: -1 })
          .skip(query.page * query.per_page)
          .limit(query.per_page),
        Coupon.countDocuments(filter),
      ]);
      res.json({ data: data.map(serializeCoupon), meta: pageMeta(query.page, query.per_page, total) });
    }),
  );

  router.post(
    "/coupons",
    requireMinRole("member"),
    validate({ body: createCouponSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.status(201).json(serializeCoupon(await createCoupon(req.tenant, req.body)));
    }),
  );

  router.patch(
    "/coupons/:id",
    requireMinRole("member"),
    validate({ body: updateCouponSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeCoupon(await updateCoupon(req.tenant, req.params.id, req.body)));
    }),
  );

  router.delete(
    "/coupons/:id",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeCoupon(await archiveCoupon(req.tenant, req.params.id)));
    }),
  );

  router.get(
    "/catalog",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const [families, products, features, metrics] = await Promise.all([
        ProductFamily.find({ tenantId: req.tenant.tenantId, archivedAt: null }),
        Product.find({ tenantId: req.tenant.tenantId, archivedAt: null }),
        Feature.find({ tenantId: req.tenant.tenantId, archivedAt: null }),
        BillableMetric.find({ tenantId: req.tenant.tenantId, archivedAt: null }),
      ]);
      res.json({
        product_families: families.map(serializeFamily),
        products: products.map(serializeProduct),
        features: features.map(serializeFeature),
        metrics: metrics.map(serializeMetric),
      });
    }),
  );

  return router;
}
