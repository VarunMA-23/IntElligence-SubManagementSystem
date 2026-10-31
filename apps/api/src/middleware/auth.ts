import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthorizedError, sha256, type ApiTokenRole, type Role } from "@brightloop/shared";
import { ApiToken, PortalToken, Tenant } from "@brightloop/db";
import type { AppConfig } from "../config/env.js";
import { verifyAccessToken, verifyPortalToken } from "../services/auth-service.js";

const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

function bearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export function authMiddleware(config: AppConfig) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = bearer(req);
      if (!token) throw new UnauthorizedError("Authentication required");

      if (token.startsWith("bl_")) {
        const record = await ApiToken.findOne({ tokenHash: sha256(token) });
        if (!record || record.revokedAt) throw new UnauthorizedError("Invalid API token");
        const tenant = await Tenant.findById(record.tenantId);
        if (!tenant) throw new UnauthorizedError("Invalid API token tenant");
        record.lastUsedAt = new Date();
        await record.save();
        const role = record.role as ApiTokenRole as Role;
        req.auth = {
          userId: record._id,
          orgId: tenant.orgId,
          tenantId: record.tenantId,
          role,
          type: "access",
        };
        req.tenant = { tenantId: record.tenantId, orgId: tenant.orgId, userId: record._id, role, actorId: record._id };
        next();
        return;
      }

      const claims = verifyAccessToken(config, token);
      req.auth = claims;
      if (claims.tenantId && claims.orgId) {
        req.tenant = {
          tenantId: claims.tenantId,
          orgId: claims.orgId,
          userId: claims.userId,
          role: claims.role,
          actorId: claims.userId,
        };
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function portalAuthMiddleware(config: AppConfig) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = req.header("x-portal-token") ?? bearer(req);
      if (!token) throw new UnauthorizedError("Portal token required");
      const claims = verifyPortalToken(config, token);
      const record = await PortalToken.findOne({ tokenHash: sha256(token), tenantId: claims.tenantId });
      if (!record || record.customerId !== claims.customerId || record.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedError("Portal link is invalid or expired");
      }
      record.lastUsedAt = new Date();
      await record.save();
      req.portal = claims;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if (!req.tenant) {
    next(new ForbiddenError("Select an organization and tenant first"));
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.tenant?.role;
    if (!role) {
      next(new UnauthorizedError("Authentication required"));
      return;
    }
    if (!roles.includes(role)) {
      next(new ForbiddenError("Your role cannot perform this action"));
      return;
    }
    next();
  };
}

export function requireMinRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const current = req.tenant?.role;
    if (!current || ROLE_RANK[current] < ROLE_RANK[role]) {
      next(new ForbiddenError("Your role cannot perform this action"));
      return;
    }
    next();
  };
}
