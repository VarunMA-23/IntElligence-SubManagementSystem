export * from "./errors.js";
export * from "./ids.js";
export * from "./money.js";
export * from "./pagination.js";
export * from "./schemas/common.js";
export * from "./schemas/auth.js";
export * from "./schemas/customers.js";
export * from "./schemas/catalog.js";
export * from "./schemas/plans.js";
export * from "./schemas/subscriptions.js";
export * from "./schemas/metering.js";
export * from "./schemas/billing.js";
export * from "./schemas/portal.js";
export * from "./schemas/webhooks.js";

export type Role = "owner" | "admin" | "member" | "viewer";
export type ApiTokenRole = "admin" | "member" | "viewer";

export interface TenantContext {
  tenantId: string;
  orgId: string;
  userId: string;
  role: Role;
  actorId: string | null;
}

export interface TokenClaims {
  userId: string;
  orgId: string;
  tenantId: string;
  role: Role;
  type: "access";
}

export interface PortalClaims {
  tenantId: string;
  customerId: string;
  type: "portal";
}
