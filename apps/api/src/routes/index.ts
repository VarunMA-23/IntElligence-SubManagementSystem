import { Router } from "express";
import type { AppConfig } from "../config/env.js";
import {
  authMiddleware,
  portalAuthMiddleware,
  requireTenant,
} from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { activityRoutes } from "./activities.js";
import { authRoutes } from "./auth.js";
import { catalogRoutes } from "./catalog.js";
import { customerRoutes } from "./customers.js";
import { internalRoutes } from "./internal.js";
import { invoiceRoutes } from "./invoices.js";
import { organizationRoutes } from "./organizations.js";
import { planRoutes } from "./plans.js";
import { portalRoutes } from "./portal.js";
import { subscriptionRoutes } from "./subscriptions.js";
import { usageRoutes } from "./usage.js";
import { webhookRoutes } from "./webhooks.js";

export function apiV1Routes(config: AppConfig) {
  const authenticate = authMiddleware(config);
  const portalAuthenticate = portalAuthMiddleware(config);
  const router = Router();

  router.use("/auth", authRoutes(config, authenticate));
  router.use(organizationRoutes(authenticate));
  router.use(portalRoutes(config, authenticate, portalAuthenticate));

  const tenantRouter = Router();
  tenantRouter.use(authenticate);
  tenantRouter.use(requireTenant);
  tenantRouter.use(idempotencyMiddleware());
  tenantRouter.use(customerRoutes());
  tenantRouter.use(catalogRoutes());
  tenantRouter.use(planRoutes());
  tenantRouter.use(subscriptionRoutes());
  tenantRouter.use(usageRoutes());
  tenantRouter.use(invoiceRoutes(config));
  tenantRouter.use(webhookRoutes(config));
  tenantRouter.use(activityRoutes());
  router.use(tenantRouter);

  return router;
}

export function privateInternalRoutes(config: AppConfig) {
  return internalRoutes(config);
}
