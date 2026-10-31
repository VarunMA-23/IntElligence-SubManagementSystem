import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  newId,
  newOpaqueToken,
  sha256,
  type PortalClaims,
  type Role,
  type TokenClaims,
} from "@brightloop/shared";
import { OrganizationMember, RefreshToken, Tenant, User } from "@brightloop/db";
import type { AppConfig } from "../config/env.js";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function issueAccessToken(config: AppConfig, claims: Omit<TokenClaims, "type">): string {
  const payload: TokenClaims = { ...claims, type: "access" };
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL as SignOptions["expiresIn"],
  });
}

export function issuePortalToken(config: AppConfig, claims: Omit<PortalClaims, "type">): string {
  const payload: PortalClaims = { ...claims, type: "portal" };
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: `${config.PORTAL_TOKEN_TTL_MINUTES}m` as SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(config: AppConfig, token: string): TokenClaims {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as TokenClaims;
    if (decoded.type !== "access" || !decoded.userId) throw new Error("invalid token");
    return decoded;
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }
}

export function verifyPortalToken(config: AppConfig, token: string): PortalClaims {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as PortalClaims;
    if (decoded.type !== "portal" || !decoded.customerId || !decoded.tenantId) throw new Error("invalid token");
    return decoded;
  } catch {
    throw new UnauthorizedError("Portal link is invalid or expired");
  }
}

function durationToMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) return 30 * 86_400_000;
  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * factor;
}

export async function createRefreshToken(
  config: AppConfig,
  input: { userId: string; orgId: string | null; tenantId: string | null; rotatedFrom?: string | null },
) {
  const plain = newOpaqueToken(40);
  const doc = await RefreshToken.create({
    userId: input.userId,
    orgId: input.orgId,
    tenantId: input.tenantId,
    tokenHash: sha256(plain),
    expiresAt: new Date(Date.now() + durationToMs(config.JWT_REFRESH_TTL)),
    rotatedFrom: input.rotatedFrom ?? null,
  });
  return { plain, doc };
}

export async function rotateRefreshToken(config: AppConfig, plain: string) {
  const hash = sha256(plain);
  const existing = await RefreshToken.findOne({ tokenHash: hash });
  if (!existing) throw new UnauthorizedError("Invalid refresh token");
  if (existing.revokedAt) {
    await RefreshToken.updateMany({ userId: existing.userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw new UnauthorizedError("Refresh token has already been used");
  }
  if (existing.expiresAt.getTime() <= Date.now()) throw new UnauthorizedError("Refresh token expired");

  existing.revokedAt = new Date();
  await existing.save();

  const membership = await OrganizationMember.findOne({ userId: existing.userId }).sort({ createdAt: 1 });
  if (!membership) throw new UnauthorizedError("No organization membership");
  const tenantId = existing.tenantId ?? (await Tenant.findOne({ orgId: membership.orgId }).sort({ createdAt: 1 }))?._id;
  if (!tenantId) throw new UnauthorizedError("No tenant available");

  const next = await createRefreshToken(config, {
    userId: existing.userId,
    orgId: membership.orgId,
    tenantId,
    rotatedFrom: existing._id,
  });
  return { userId: existing.userId, orgId: membership.orgId, tenantId, role: membership.role as Role, refresh: next };
}

export async function primaryTenantForUser(userId: string): Promise<{ orgId: string; tenantId: string; role: Role }> {
  const membership = await OrganizationMember.findOne({ userId }).sort({ createdAt: 1 });
  if (!membership) throw new UnauthorizedError("No organization membership");
  const tenant = await Tenant.findOne({ orgId: membership.orgId }).sort({ createdAt: 1 });
  if (!tenant) throw new UnauthorizedError("No tenant available");
  return { orgId: membership.orgId, tenantId: tenant._id, role: membership.role as Role };
}

export async function requireMembership(userId: string, orgId: string) {
  const membership = await OrganizationMember.findOne({ userId, orgId });
  if (!membership) throw new ForbiddenError("You are not a member of this organization");
  return membership;
}

export async function createUser(input: { email: string; password: string; name: string }) {
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    return { user: existing, existing: true };
  }
  const user = await User.create({
    _id: newId(),
    email: input.email,
    passwordHash: await hashPassword(input.password),
    name: input.name,
    emailVerifiedAt: null,
  });
  return { user, existing: false };
}

export async function assertVerified(user: { emailVerifiedAt: Date | null }) {
  if (!user.emailVerifiedAt) {
    throw new ForbiddenError("Email verification is required");
  }
}

export async function assertNotLastOwner(orgId: string, userId: string) {
  const target = await OrganizationMember.findOne({ orgId, userId });
  if (!target) throw new UnauthorizedError("Member not found");
  if (target.role !== "owner") return;
  const owners = await OrganizationMember.countDocuments({ orgId, role: "owner" });
  if (owners <= 1) throw new ConflictError("The last owner cannot be removed or demoted");
}
