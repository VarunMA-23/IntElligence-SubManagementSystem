import { Router } from "express";
import {
  ForbiddenError,
  createCustomerSchema,
  customerListQuerySchema,
  updateCustomerSchema,
} from "@brightloop/shared";
import { asyncHandler, pageMeta } from "../lib/http.js";
import { serializeCustomer } from "../lib/serializers.js";
import { requireMinRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  archiveCustomer,
  createCustomer,
  customerOverview,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../services/customer-service.js";

export function customerRoutes() {
  const router = Router();

  router.get(
    "/customers",
    validate({ query: customerListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const result = await listCustomers(req.tenant.tenantId, query);
      res.json({
        data: result.data.map(serializeCustomer),
        meta: pageMeta(query.page, query.per_page, result.total),
      });
    }),
  );

  router.post(
    "/customers",
    requireMinRole("member"),
    validate({ body: createCustomerSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const customer = await createCustomer(req.tenant, req.body);
      res.status(201).json(serializeCustomer(customer));
    }),
  );

  router.get(
    "/customers/:idOrAlias",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const customer = await getCustomer(req.tenant.tenantId, req.params.idOrAlias);
      res.json(serializeCustomer(customer));
    }),
  );

  router.patch(
    "/customers/:idOrAlias",
    requireMinRole("member"),
    validate({ body: updateCustomerSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const customer = await getCustomer(req.tenant.tenantId, req.params.idOrAlias);
      const updated = await updateCustomer(req.tenant, String(customer._id), req.body);
      res.json(serializeCustomer(updated));
    }),
  );

  router.delete(
    "/customers/:idOrAlias",
    requireMinRole("admin"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const customer = await getCustomer(req.tenant.tenantId, req.params.idOrAlias);
      const archived = await archiveCustomer(req.tenant, String(customer._id));
      res.json(serializeCustomer(archived));
    }),
  );

  router.get(
    "/customers/:idOrAlias/overview",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const customer = await getCustomer(req.tenant.tenantId, req.params.idOrAlias);
      const overview = await customerOverview(req.tenant.tenantId, String(customer._id));
      res.json({
        customer: serializeCustomer(overview.customer),
        subscriptions: overview.subscriptions.map((subscription) => ({
          id: String(subscription._id),
          status: subscription.status,
          plan_id: subscription.planId,
          created_at: subscription.createdAt,
        })),
      });
    }),
  );

  return router;
}
