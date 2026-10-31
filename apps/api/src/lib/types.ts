import type { PortalClaims, TenantContext, TokenClaims } from "@brightloop/shared";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: TokenClaims | null;
      tenant?: TenantContext;
      portal?: PortalClaims;
      rawBodyText?: string;
    }
  }
}

export {};
