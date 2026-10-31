import { Router } from "express";
import {
  ForbiddenError,
  createPlanSchema,
  planListQuerySchema,
  publishPlanSchema,
  updatePlanSchema,
} from "@brightloop/shared";
import { Plan, PlanVersion, PriceComponent } from "@brightloop/db";
import { asyncHandler, escapeRegex, pageMeta } from "../lib/http.js";
import { serializeEntitlement, serializePlan, serializePlanVersion } from "../lib/serializers.js";
import { requireMinRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  archivePlan,
  createPlan,
  listPlanVersions,
  planWithVersion,
  publishPlan,
  updatePlan,
} from "../services/plan-service.js";
import { entitlementsForPlanVersion } from "../services/entitlement-service.js";

export function planRoutes() {
  const router = Router();

  router.get(
    "/plans",
    validate({ query: planListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const filter: Record<string, unknown> = {
        tenantId: req.tenant.tenantId,
        ...(query.archived ? { archivedAt: { $ne: null } } : { archivedAt: null }),
      };
      if (query.status) filter.status = query.status;
      if (query.search) {
        const regex = new RegExp(escapeRegex(query.search), "i");
        filter.$or = [{ name: regex }, { alias: regex }];
      }
      const sort = query.order_by
        ? { [query.order_by.split(".")[0]!]: query.order_by.endsWith(".asc") ? 1 : -1 }
        : { createdAt: -1 };
      const [plans, total] = await Promise.all([
        Plan.find(filter)
          .sort(sort as any)
          .skip(query.page * query.per_page)
          .limit(query.per_page),
        Plan.countDocuments(filter),
      ]);
      const versionIds = plans.map((plan) => plan.currentVersionId).filter(Boolean) as string[];
      const versions = await PlanVersion.find({ tenantId: req.tenant.tenantId, _id: { $in: versionIds } });
      res.json({
        data: plans.map((plan) =>
          serializePlan(
            plan,
            versions.find((version) => String(version._id) === plan.currentVersionId),
          ),
        ),
        meta: pageMeta(query.page, query.per_page, total),
      });
    }),
  );

  router.post(
    "/plans",
    requireMinRole("admin"),
    validate({ body: createPlanSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.status(201).json(serializePlan(await createPlan(req.tenant, req.body)));
    }),
  );

  router.get(
    "/plans/:id",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const { plan, version, components } = await planWithVersion(req.tenant.tenantId, req.params.id);
      res.json(serializePlan(plan, version, components));
    }),
  );

  router.patch(
    "/plans/:id",
    requireMinRole("admin"),
    validate({ body: updatePlanSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const plan = await updatePlan(req.tenant, req.params.id, req.body);
      const version = plan.currentVersionId
        ? await PlanVersion.findOne({ _id: plan.currentVersionId, tenantId: req.tenant.tenantId })
        : null;
      const components = version
        ? await PriceComponent.find({ tenantId: req.tenant.tenantId, planVersionId: String(version._id) })
        : [];
      res.json(serializePlan(plan, version, components));
    }),
  );

  router.post(
    "/plans/:id/publish",
    requireMinRole("admin"),
    validate({ body: publishPlanSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const version = await publishPlan(req.tenant, req.params.id, req.body);
      const components = await PriceComponent.find({
        tenantId: req.tenant.tenantId,
        planVersionId: String(version._id),
      }).sort({ order: 1 });
      res.json(serializePlanVersion(version, components));
    }),
  );

  router.get(
    "/plans/:id/versions",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const versions = await listPlanVersions(req.tenant.tenantId, req.params.id);
      const components = await PriceComponent.find({
        tenantId: req.tenant.tenantId,
        planVersionId: { $in: versions.map((version) => String(version._id)) },
      }).sort({ order: 1 });
      res.json({
        data: versions.map((version) =>
          serializePlanVersion(
            version,
            components.filter((component) => component.planVersionId === String(version._id)),
          ),
        ),
      });
    }),
  );

  router.get(
    "/plans/:id/entitlements",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const { plan } = await planWithVersion(req.tenant.tenantId, req.params.id);
      if (!plan.currentVersionId) {
        res.json({ data: [] });
        return;
      }
      const entitlements = await entitlementsForPlanVersion(req.tenant.tenantId, plan.currentVersionId);
      res.json({ data: entitlements.map(serializeEntitlement) });
    }),
  );

  router.delete(
    "/plans/:id",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const plan = await archivePlan(req.tenant, req.params.id);
      res.json(serializePlan(plan));
    }),
  );

  return router;
}
