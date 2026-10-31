import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  newId,
  newOpaqueToken,
  sha256,
  type TenantContext,
} from "@brightloop/shared";
import {
  ApiToken,
  InvoicingEntity,
  Organization,
  OrganizationInvite,
  OrganizationMember,
  Tenant,
  User,
} from "@brightloop/db";
import { recordActivity } from "../lib/domain.js";
import {
  assertNotLastOwner,
  createUser,
  hashPassword,
  requireMembership,
  verifyPassword,
} from "./auth-service.js";

export function tenantSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

async function uniqueSlug(base: string, check: (slug: string) => Promise<boolean>) {
  let candidate = base || `workspace-${Math.random().toString(36).slice(2, 8)}`;
  let suffix = 1;
  while (await check(candidate)) {
    candidate = `${base.slice(0, 56)}-${suffix += 1}`;
  }
  return candidate;
}

export async function createOrganization(
  userId: string,
  input: { name: string; slug?: string; tenant_name?: string; currency: string },
) {
  const base = input.slug ?? tenantSlug(input.name);
  const slug = await uniqueSlug(base, async (candidate) => Boolean(await Organization.findOne({ slug: candidate })));
  const orgId = newId();
  const tenantId = newId();
  const org = await Organization.create({ _id: orgId, name: input.name, slug, createdBy: userId });
  await OrganizationMember.create({ orgId, userId, role: "owner" });
  const tenant = await Tenant.create({
    _id: tenantId,
    orgId,
    name: input.tenant_name ?? input.name,
    slug: "default",
    currency: input.currency,
  });
  await InvoicingEntity.create({
    tenantId,
    name: input.name,
    legalName: null,
    address: null,
    taxId: null,
    defaultCurrency: input.currency,
    netTerms: 30,
    isDefault: true,
  });
  return { org, tenant };
}

export async function createTenant(
  userId: string,
  orgId: string,
  input: { name: string; slug?: string; currency: string },
) {
  await requireMembership(userId, orgId);
  const base = input.slug ?? tenantSlug(input.name);
  const slug = await uniqueSlug(base, async (candidate) =>
    Boolean(await Tenant.findOne({ orgId, slug: candidate })),
  );
  const tenant = await Tenant.create({ orgId, name: input.name, slug, currency: input.currency });
  await InvoicingEntity.create({
    tenantId: String(tenant._id),
    name: input.name,
    legalName: null,
    address: null,
    taxId: null,
    defaultCurrency: input.currency,
    netTerms: 30,
    isDefault: true,
  });
  return tenant;
}

export async function listUserOrganizations(userId: string) {
  const memberships = await OrganizationMember.find({ userId });
  const orgs = await Organization.find({ _id: { $in: memberships.map((membership) => membership.orgId) } });
  const tenants = await Tenant.find({ orgId: { $in: orgs.map((org) => String(org._id)) } });
  return orgs.map((org) => ({
    id: String(org._id),
    name: org.name,
    slug: org.slug,
    role: memberships.find((membership) => membership.orgId === String(org._id))?.role ?? "member",
    tenants: tenants
      .filter((tenant) => tenant.orgId === String(org._id))
      .map((tenant) => ({
        id: String(tenant._id),
        name: tenant.name,
        slug: tenant.slug,
        currency: tenant.currency,
      })),
  }));
}

export async function updateOrganization(userId: string, orgId: string, input: { name?: string; slug?: string }) {
  await requireMembership(userId, orgId);
  const org = await Organization.findOne({ _id: orgId });
  if (!org) throw new NotFoundError("Organization");
  if (input.slug && input.slug !== org.slug) {
    const existing = await Organization.findOne({ slug: input.slug });
    if (existing) throw new ConflictError("Organization slug is already in use");
    org.slug = input.slug;
  }
  if (input.name) org.name = input.name;
  await org.save();
  return org;
}

export async function updateTenant(ctx: TenantContext, tenantId: string, input: { name?: string; currency?: string }) {
  if (ctx.tenantId !== tenantId) throw new ForbiddenError("You cannot modify another tenant");
  const tenant = await Tenant.findOne({ _id: tenantId, orgId: ctx.orgId });
  if (!tenant) throw new NotFoundError("Tenant");
  if (input.name) tenant.name = input.name;
  if (input.currency) tenant.currency = input.currency;
  await tenant.save();
  return tenant;
}

export async function listMembers(orgId: string) {
  const members = await OrganizationMember.find({ orgId });
  const users = await User.find({ _id: { $in: members.map((member) => member.userId) } });
  return members.map((member) => {
    const user = users.find((candidate) => String(candidate._id) === member.userId);
    return {
      id: member.userId,
      email: user?.email ?? "",
      name: user?.name ?? "",
      role: member.role,
      joined_at: member.createdAt,
    };
  });
}

export async function updateMemberRole(
  actorId: string,
  orgId: string,
  targetUserId: string,
  role: "owner" | "admin" | "member" | "viewer",
) {
  const actor = await requireMembership(actorId, orgId);
  if (actor.role !== "owner" && role === "owner") throw new ForbiddenError("Only owners can grant ownership");
  if (actor.role !== "owner" && targetUserId !== actorId) throw new ForbiddenError("Only owners can change other members");
  const member = await OrganizationMember.findOne({ orgId, userId: targetUserId });
  if (!member) throw new NotFoundError("Member");
  if (member.role === "owner" && role !== "owner") await assertNotLastOwner(orgId, targetUserId);
  member.role = role;
  await member.save();
  return member;
}

export async function removeMember(actorId: string, orgId: string, targetUserId: string) {
  const actor = await requireMembership(actorId, orgId);
  if (actor.role !== "owner" && targetUserId !== actorId) throw new ForbiddenError("Only owners can remove other members");
  await assertNotLastOwner(orgId, targetUserId);
  await OrganizationMember.deleteOne({ orgId, userId: targetUserId });
}

export async function createInvite(
  actorId: string,
  orgId: string,
  input: { email: string; role: "admin" | "member" | "viewer" },
) {
  const actor = await requireMembership(actorId, orgId);
  if (actor.role === "viewer" || actor.role === "member") throw new ForbiddenError("Your role cannot invite members");
  const plain = newOpaqueToken(32);
  await OrganizationInvite.create({
    orgId,
    email: input.email,
    role: input.role,
    tokenHash: sha256(plain),
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
  return { token: plain, email: input.email, role: input.role, expires_at: new Date(Date.now() + 7 * 86_400_000) };
}

export async function listInvites(orgId: string) {
  return OrganizationInvite.find({ orgId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } });
}

export async function revokeInvite(actorId: string, orgId: string, inviteId: string) {
  const actor = await requireMembership(actorId, orgId);
  if (actor.role !== "owner" && actor.role !== "admin") throw new ForbiddenError("Your role cannot revoke invites");
  const invite = await OrganizationInvite.findOne({ _id: inviteId, orgId });
  if (!invite) throw new NotFoundError("Invite");
  invite.revokedAt = new Date();
  await invite.save();
}

export async function acceptInvite(input: { token: string; name?: string; password?: string }) {
  const invite = await OrganizationInvite.findOne({
    tokenHash: sha256(input.token),
    acceptedAt: null,
    revokedAt: null,
  });
  if (!invite || invite.expiresAt.getTime() <= Date.now()) throw new UnauthorizedError("Invite is invalid or expired");
  let user = await User.findOne({ email: invite.email });
  if (!user) {
    if (!input.name || !input.password) throw new BadRequestError("name and password are required");
    const created = await createUser({ email: invite.email, password: input.password, name: input.name });
    user = created.user;
    user.emailVerifiedAt = new Date();
    await user.save();
  } else {
    if (!input.password || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new UnauthorizedError("Invalid password");
    }
    await assertNoDuplicateMembership(invite.orgId, String(user._id));
  }
  const existing = await OrganizationMember.findOne({ orgId: invite.orgId, userId: String(user._id) });
  if (!existing) {
    await OrganizationMember.create({ orgId: invite.orgId, userId: String(user._id), role: invite.role });
  }
  invite.acceptedAt = new Date();
  await invite.save();
  const tenant = await Tenant.findOne({ orgId: invite.orgId }).sort({ createdAt: 1 });
  if (!tenant) throw new NotFoundError("Tenant");
  await recordActivity({
    tenantId: String(tenant._id),
    entityType: "member",
    entityId: String(user._id),
    action: "joined",
    actorId: String(user._id),
    diff: { role: invite.role },
  });
  return { user, orgId: invite.orgId, tenantId: String(tenant._id), role: invite.role };
}

async function assertNoDuplicateMembership(_orgId: string, _userId: string) {
  return;
}

export async function createApiToken(ctx: TenantContext, input: { name: string; role: "admin" | "member" | "viewer" }) {
  const plain = `bl_${newOpaqueToken(32)}`;
  const token = await ApiToken.create({
    tenantId: ctx.tenantId,
    name: input.name,
    tokenHash: sha256(plain),
    prefix: plain.slice(0, 10),
    role: input.role,
    lastUsedAt: null,
  });
  return { token, plain };
}

export async function listApiTokens(tenantId: string) {
  return ApiToken.find({ tenantId, revokedAt: null }).sort({ createdAt: -1 });
}

export async function revokeApiToken(tenantId: string, tokenId: string) {
  const token = await ApiToken.findOne({ _id: tokenId, tenantId });
  if (!token) throw new NotFoundError("API token");
  token.revokedAt = new Date();
  await token.save();
  return token;
}

export async function hashNewPassword(password: string) {
  return hashPassword(password);
}
