import { Router, type RequestHandler } from "express";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  checkoutListQuerySchema,
  completeCheckoutSchema,
  createCheckoutSchema,
  createPortalTokenSchema,
  type TenantContext,
} from "@brightloop/shared";
import {
  CheckoutSession,
  Invoice,
  InvoiceLineItem,
  Plan,
  Subscription,
} from "@brightloop/db";
import type { AppConfig } from "../config/env.js";
import { asyncHandler, pageMeta } from "../lib/http.js";
import {
  serializeCheckout,
  serializeEntitlement,
  serializeInvoice,
  serializePortalCustomer,
  serializeSubscription,
} from "../lib/serializers.js";
import { requireMinRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  cancelCheckoutSession,
  completeCheckoutSession,
  createCheckoutSession,
  createPortalLink,
  portalCheckout,
  portalCustomer,
} from "../services/checkout-service.js";
import { effectiveEntitlementsForCustomer, entitlementUsageForFeature } from "../services/entitlement-service.js";
import { invoicePdfBuffer } from "../services/invoice-service.js";
import { usageForCustomer } from "../services/metering-service.js";

function portalContext(req: any): TenantContext {
  if (!req.portal) throw new UnauthorizedError("Portal token required");
  return {
    tenantId: req.portal.tenantId,
    orgId: "",
    userId: `portal:${req.portal.customerId}`,
    role: "viewer",
    actorId: null,
  };
}

function portalPeriod(query: any) {
  const now = new Date();
  const start = query.period_start
    ? new Date(query.period_start)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = query.period_end
    ? new Date(query.period_end)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestError("invalid usage period");
  return { start, end };
}

export function portalRoutes(
  config: AppConfig,
  authenticate: RequestHandler,
  portalAuthenticate: RequestHandler,
) {
  const router = Router();

  router.post(
    "/portal/tokens",
    authenticate,
    requireMinRole("member"),
    validate({ body: createPortalTokenSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.status(201).json(await createPortalLink(config, req.tenant, req.body.customer_id));
    }),
  );

  router.get(
    "/checkout/sessions",
    authenticate,
    validate({ query: checkoutListQuerySchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const query = req.query as any;
      const filter: Record<string, unknown> = { tenantId: req.tenant.tenantId };
      if (query.customer_id) filter.customerId = query.customer_id;
      if (query.status) filter.status = query.status;
      const [data, total] = await Promise.all([
        CheckoutSession.find(filter)
          .sort({ createdAt: -1 })
          .skip(query.page * query.per_page)
          .limit(query.per_page),
        CheckoutSession.countDocuments(filter),
      ]);
      res.json({ data: data.map(serializeCheckout), meta: pageMeta(query.page, query.per_page, total) });
    }),
  );

  router.post(
    "/checkout/sessions",
    authenticate,
    requireMinRole("member"),
    validate({ body: createCheckoutSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const { session } = await createCheckoutSession(req.tenant, req.body);
      res.status(201).json(serializeCheckout(session));
    }),
  );

  router.get(
    "/checkout/sessions/:id",
    authenticate,
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const session = await CheckoutSession.findOne({ _id: req.params.id, tenantId: req.tenant.tenantId });
      if (!session) throw new NotFoundError("Checkout session");
      res.json(serializeCheckout(session));
    }),
  );

  router.post(
    "/checkout/sessions/:id/complete",
    authenticate,
    requireMinRole("member"),
    validate({ body: completeCheckoutSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeCheckout(await completeCheckoutSession(req.tenant, req.params.id, req.body.simulate_failure)));
    }),
  );

  router.post(
    "/checkout/sessions/:id/cancel",
    authenticate,
    requireMinRole("member"),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      res.json(serializeCheckout(await cancelCheckoutSession(req.tenant, req.params.id)));
    }),
  );

  router.use("/portal", portalAuthenticate);

  router.get(
    "/portal/me",
    asyncHandler(async (req, res) => {
      const customer = await portalCustomer(req.portal!.tenantId, req.portal!.customerId);
      const subscriptions = await Subscription.find({
        tenantId: req.portal!.tenantId,
        customerId: req.portal!.customerId,
      }).sort({ createdAt: -1 });
      res.json({
        customer: serializePortalCustomer(customer),
        subscriptions: subscriptions.map((subscription) => serializeSubscription(subscription)),
      });
    }),
  );

  router.get(
    "/portal/plans",
    asyncHandler(async (req, res) => {
      const plans = await Plan.find({
        tenantId: req.portal!.tenantId,
        status: "ACTIVE",
        archivedAt: null,
      }).sort({ selfServiceRank: 1, createdAt: 1 });
      res.json({
        data: plans.map((plan) => ({
          id: String(plan._id),
          name: plan.name,
          alias: plan.alias,
          description: plan.description,
          currency: plan.currency,
          billing_period: plan.billingPeriod,
          trial_days: plan.trialDays,
          self_service_rank: plan.selfServiceRank,
          current_version_id: plan.currentVersionId,
        })),
      });
    }),
  );

  router.get(
    "/portal/subscriptions",
    asyncHandler(async (req, res) => {
      const subscriptions = await Subscription.find({
        tenantId: req.portal!.tenantId,
        customerId: req.portal!.customerId,
      }).sort({ createdAt: -1 });
      res.json({ data: subscriptions.map((subscription) => serializeSubscription(subscription)) });
    }),
  );

  router.get(
    "/portal/invoices",
    asyncHandler(async (req, res) => {
      const invoices = await Invoice.find({
        tenantId: req.portal!.tenantId,
        customerId: req.portal!.customerId,
        status: { $in: ["FINALIZED", "VOID", "UNCOLLECTIBLE"] },
      }).sort({ createdAt: -1 });
      res.json({ data: invoices.map((invoice) => serializeInvoice(invoice)) });
    }),
  );

  router.get(
    "/portal/invoices/:id",
    asyncHandler(async (req, res) => {
      const invoice = await Invoice.findOne({
        _id: req.params.id,
        tenantId: req.portal!.tenantId,
        customerId: req.portal!.customerId,
      });
      if (!invoice) throw new NotFoundError("Invoice");
      const lines = await InvoiceLineItem.find({
        tenantId: req.portal!.tenantId,
        invoiceId: String(invoice._id),
      }).sort({ order: 1 });
      res.json(serializeInvoice(invoice, lines));
    }),
  );

  router.get(
    "/portal/invoices/:id/pdf",
    asyncHandler(async (req, res) => {
      const invoice = await Invoice.findOne({
        _id: req.params.id,
        tenantId: req.portal!.tenantId,
        customerId: req.portal!.customerId,
      });
      if (!invoice) throw new NotFoundError("Invoice");
      const buffer = await invoicePdfBuffer(config, req.portal!.tenantId, String(invoice._id));
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${invoice.number}.pdf"`);
      res.send(buffer);
    }),
  );

  router.get(
    "/portal/entitlements",
    asyncHandler(async (req, res) => {
      const ctx = portalContext(req);
      const entitlements = await effectiveEntitlementsForCustomer(ctx.tenantId, req.portal!.customerId);
      res.json({ data: entitlements.map(serializeEntitlement) });
    }),
  );

  router.get(
    "/portal/usage",
    asyncHandler(async (req, res) => {
      const ctx = portalContext(req);
      const { start, end } = portalPeriod(req.query);
      res.json({
        data: await usageForCustomer(ctx.tenantId, req.portal!.customerId, start, end, req.query.metric_code as any),
        period_start: start.toISOString(),
        period_end: end.toISOString(),
      });
    }),
  );

  router.post(
    "/portal/checkout",
    asyncHandler(async (req, res) => {
      const ctx = portalContext(req);
      const { session } = await portalCheckout(ctx, req.portal!.customerId, req.body ?? {});
      res.status(201).json(serializeCheckout(session));
    }),
  );

  router.post(
    "/portal/checkout/:id/complete",
    asyncHandler(async (req, res) => {
      const ctx = portalContext(req);
      const session = await CheckoutSession.findOne({
        _id: req.params.id,
        tenantId: ctx.tenantId,
        customerId: req.portal!.customerId,
      });
      if (!session) throw new NotFoundError("Checkout session");
      res.json(serializeCheckout(await completeCheckoutSession(ctx, req.params.id, false)));
    }),
  );

  router.get(
    "/portal/features/:featureCode/usage",
    asyncHandler(async (req, res) => {
      const ctx = portalContext(req);
      const { start, end } = portalPeriod(req.query);
      res.json({
        feature_code: req.params.featureCode,
        used: await entitlementUsageForFeature(ctx.tenantId, req.portal!.customerId, req.params.featureCode, {
          start,
          end,
        }),
        period_start: start.toISOString(),
        period_end: end.toISOString(),
      });
    }),
  );

  return router;
}
