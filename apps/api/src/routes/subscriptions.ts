import { Router } from "express";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  cancelSubscriptionSchema,
  createSubscriptionSchema,
  subscriptionListQuerySchema,
  updateSubscriptionSchema,
} from "@brightloop/shared";
import { Customer, Invoice, Subscription } from "@brightloop/db";
import { asyncHandler, escapeRegex, pageMeta } from "../lib/http.js";
import {
  serializeEntitlement,
  serializeInvoice,
  serializeSubscription,
} from "../lib/serializers.js";
import { requireMinRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  cancelSubscription,
  createSubscription,
  subscriptionDetails,
  updateSubscription,
} from "../services/subscription-service.js";
import { effectiveEntitlementsForSubscription } from "../services/entitlement-service.js";
import { usageForCustomer } from "../services/metering-service.js";
import { resolveCustomer } from "../lib/domain.js";

function periodFromQuery(query: any) {
  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const start = query.period_start ? new Date(query.period_start) : defaultStart;
  const end = query.period_end ? new Date(query.period_end) : defaultEnd;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestError("invalid usage period");
  return { start, end };
}

export function subscriptionRoutes() {
  const router = Router();

  router.get(
    "/subscriptions",
    validate({ query: subscriptionListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const filter: Record<string, unknown> = { tenantId: req.tenant.tenantId };
      if (query.status) filter.status = query.status;
      if (query.customer_id_or_alias) {
        const customer = await resolveCustomer(req.tenant.tenantId, query.customer_id_or_alias);
        filter.customerId = String(customer._id);
      } else if (query.customer_id) {
        filter.customerId = query.customer_id;
      }
      if (query.search) filter.purchaseOrder = new RegExp(escapeRegex(query.search), "i");
      const [subscriptions, total] = await Promise.all([
        Subscription.find(filter)
          .sort({ createdAt: -1 })
          .skip(query.page * query.per_page)
          .limit(query.per_page),
        Subscription.countDocuments(filter),
      ]);
      const customers = await Customer.find({
        tenantId: req.tenant.tenantId,
        _id: { $in: subscriptions.map((subscription) => subscription.customerId) },
      });
      res.json({
        data: subscriptions.map((subscription) =>
          serializeSubscription(subscription, {
            customer_alias: customers.find((customer) => String(customer._id) === subscription.customerId)?.alias ?? null,
          }),
        ),
        meta: pageMeta(query.page, query.per_page, total),
      });
    }),
  );

  router.post(
    "/subscriptions",
    requireMinRole("member"),
    validate({ body: createSubscriptionSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const subscription = await createSubscription(req.tenant, req.body);
      res.status(201).json(serializeSubscription(subscription));
    }),
  );

  router.get(
    "/subscriptions/:id",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const details = await subscriptionDetails(req.tenant.tenantId, req.params.id);
      res.json(
        serializeSubscription(details.subscription, {
          components: details.components.map((component) => ({
            id: String(component._id),
            price_component_id: component.priceComponentId,
            quantity: component.quantity,
          })),
          add_ons: details.addOns.map((addOn) => ({
            id: String(addOn._id),
            add_on_id: addOn.addOnId,
            quantity: addOn.quantity,
          })),
          coupons: details.coupons.map((coupon) => ({
            id: String(coupon._id),
            coupon_id: coupon.couponId,
            status: coupon.status,
          })),
        }),
      );
    }),
  );

  router.patch(
    "/subscriptions/:id",
    requireMinRole("member"),
    validate({ body: updateSubscriptionSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const subscription = await updateSubscription(req.tenant, req.params.id, req.body);
      res.json(serializeSubscription(subscription));
    }),
  );

  const cancelHandler = asyncHandler(async (req, res) => {
    if (!req.tenant) throw new ForbiddenError("Select a tenant first");
    const subscription = await cancelSubscription(req.tenant, req.params.id, req.body ?? {});
    res.json(serializeSubscription(subscription));
  });

  router.post(
    "/subscriptions/:id/cancel",
    requireMinRole("member"),
    validate({ body: cancelSubscriptionSchema }),
    cancelHandler,
  );

  router.delete(
    "/subscriptions/:id",
    requireMinRole("member"),
    validate({ body: cancelSubscriptionSchema }),
    cancelHandler,
  );

  router.get(
    "/subscriptions/:id/entitlements",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const subscription = await Subscription.findOne({ _id: req.params.id, tenantId: req.tenant.tenantId });
      if (!subscription) throw new NotFoundError("Subscription");
      const entitlements = await effectiveEntitlementsForSubscription(req.tenant.tenantId, subscription);res.json({ data: entitlements.map(serializeEntitlement) });
    }),
  );

  router.get(
    "/subscriptions/:id/usage",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const subscription = await Subscription.findOne({ _id: req.params.id, tenantId: req.tenant.tenantId });
      if (!subscription) throw new NotFoundError("Subscription");
      const { start, end } = periodFromQuery(req.query);
      res.json({
        data: await usageForCustomer(req.tenant.tenantId, subscription.customerId, start, end),
        period_start: start.toISOString().slice(0, 10),
        period_end: end.toISOString().slice(0, 10),
      });
    }),
  );

  router.get(
    "/subscriptions/:id/invoices",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const invoices = await Invoice.find({ tenantId: req.tenant.tenantId, subscriptionId: req.params.id }).sort({
        createdAt: -1,
      });
      res.json({ data: invoices.map((invoice) => serializeInvoice(invoice)) });
    }),
  );
  return router;
}

