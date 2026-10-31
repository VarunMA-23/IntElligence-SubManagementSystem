import { Router } from "express";
import { ForbiddenError, entityActivityQuerySchema } from "@brightloop/shared";
import { EntityActivity } from "@brightloop/db";
import { asyncHandler, pageMeta } from "../lib/http.js";
import { serializeActivity } from "../lib/serializers.js";
import { validate } from "../middleware/validate.js";

export function activityRoutes() {
  const router = Router();

  router.get(
    "/activities",
    validate({ query: entityActivityQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const filter: Record<string, unknown> = { tenantId: req.tenant.tenantId };
      if (query.entity_type) filter.entityType = query.entity_type;
      if (query.entity_id) filter.entityId = query.entity_id;
      const [data, total] = await Promise.all([
        EntityActivity.find(filter)
          .sort({ createdAt: -1 })
          .skip(query.page * query.per_page)
          .limit(query.per_page),
        EntityActivity.countDocuments(filter),
      ]);
      res.json({
        data: data.map(serializeActivity),
        meta: pageMeta(query.page, query.per_page, total),
      });
    }),
  );

  return router;
}
