import { Router, type RequestHandler } from "express";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  createTenantSchema,
  inviteMemberSchema,
  updateMemberSchema,
  updateOrganizationSchema,
  updateTenantSchema,
  createApiTokenSchema,
} from "@brightloop/shared";
import { InvoicingEntity, Organization, Tenant } from "@brightloop/db";
import { asyncHandler } from "../lib/http.js";
import { iso } from "../lib/serializers.js";
import { validate } from "../middleware/validate.js";
import { requireMembership } from "../services/auth-service.js";
import {
  createApiToken,
  createInvite,
  createTenant,
  listApiTokens,
  listInvites,
  listMembers,
  listUserOrganizations,
  removeMember,
  revokeApiToken,
  revokeInvite,
  updateMemberRole,
  updateOrganization,
  updateTenant,
} from "../services/organization-service.js";

export function organizationRoutes(authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate);

  router.get(
    "/organizations",
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      res.json({ data: await listUserOrganizations(req.auth.userId) });
    }),
  );

  router.get(
    "/organizations/:id",
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      await requireMembership(req.auth.userId, req.params.id);
      const org = await Organization.findById(req.params.id);
      if (!org) throw new NotFoundError("Organization");
      const tenants = await Tenant.find({ orgId: req.params.id });
      res.json({
        id: String(org._id),
        name: org.name,
        slug: org.slug,
        created_at: iso(org.createdAt),
        tenants: tenants.map((tenant) => ({
          id: String(tenant._id),
          name: tenant.name,
          slug: tenant.slug,
          currency: tenant.currency,
        })),
      });
    }),
  );

  router.patch(
    "/organizations/:id",
    validate({ body: updateOrganizationSchema }),
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      const membership = await requireMembership(req.auth.userId, req.params.id);
      if (membership.role !== "owner" && membership.role !== "admin") {
        throw new ForbiddenError("Your role cannot update the organization");
      }
      const org = await updateOrganization(req.auth.userId, req.params.id, req.body);
      res.json({ id: String(org._id), name: org.name, slug: org.slug });
    }),
  );

  router.get(
    "/tenants",
    asyncHandler(async (req, res) => {
      if (!req.auth?.orgId) throw new UnauthorizedError();
      const tenants = await Tenant.find({ orgId: req.auth.orgId });
      res.json({
        data: tenants.map((tenant) => ({
          id: String(tenant._id),
          name: tenant.name,
          slug: tenant.slug,
          currency: tenant.currency,
        })),
      });
    }),
  );

  router.post(
    "/organizations/:id/tenants",
    validate({ body: createTenantSchema }),
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      const membership = await requireMembership(req.auth.userId, req.params.id);
      if (membership.role === "viewer" || membership.role === "member") {
        throw new ForbiddenError("Your role cannot create tenants");
      }
      const tenant = await createTenant(req.auth.userId, req.params.id, req.body);
      res.status(201).json({
        id: String(tenant._id),
        name: tenant.name,
        slug: tenant.slug,
        currency: tenant.currency,
      });
    }),
  );

  router.patch(
    "/tenants/:id",
    validate({ body: updateTenantSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      if (req.tenant.role === "viewer" || req.tenant.role === "member") {
        throw new ForbiddenError("Your role cannot update the tenant");
      }
      const tenant = await updateTenant(req.tenant, req.params.id, req.body);
      res.json({ id: String(tenant._id), name: tenant.name, currency: tenant.currency });
    }),
  );

  router.get(
    "/organizations/:id/members",
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      await requireMembership(req.auth.userId, req.params.id);
      res.json({ data: await listMembers(req.params.id) });
    }),
  );

  router.patch(
    "/organizations/:id/members/:userId",
    validate({ body: updateMemberSchema }),
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      const member = await updateMemberRole(req.auth.userId, req.params.id, req.params.userId, req.body.role);
      res.json({ id: member.userId, role: member.role });
    }),
  );

  router.delete(
    "/organizations/:id/members/:userId",
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      await removeMember(req.auth.userId, req.params.id, req.params.userId);
      res.status(204).send();
    }),
  );

  router.get(
    "/organizations/:id/invites",
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      await requireMembership(req.auth.userId, req.params.id);
      const invites = await listInvites(req.params.id);
      res.json({
        data: invites.map((invite) => ({
          id: String(invite._id),
          email: invite.email,
          role: invite.role,
          expires_at: iso(invite.expiresAt),
          created_at: iso(invite.createdAt),
        })),
      });
    }),
  );

  router.post(
    "/organizations/:id/invites",
    validate({ body: inviteMemberSchema }),
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      const invite = await createInvite(req.auth.userId, req.params.id, req.body);
      res.status(201).json({
        email: invite.email,
        role: invite.role,
        expires_at: invite.expires_at.toISOString(),
        invite_token: invite.token,
      });
    }),
  );

  router.delete(
    "/organizations/:id/invites/:inviteId",
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      await revokeInvite(req.auth.userId, req.params.id, req.params.inviteId);
      res.status(204).send();
    }),
  );

  router.get(
    "/api-tokens",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const tokens = await listApiTokens(req.tenant.tenantId);
      res.json({
        data: tokens.map((token) => ({
          id: String(token._id),
          name: token.name,
          prefix: token.prefix,
          role: token.role,
          last_used_at: iso(token.lastUsedAt),
          created_at: iso(token.createdAt),
        })),
      });
    }),
  );

  router.post(
    "/api-tokens",
    validate({ body: createApiTokenSchema }),
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      if (req.tenant.role === "viewer" || req.tenant.role === "member") {
        throw new ForbiddenError("Your role cannot create API tokens");
      }
      const { token, plain } = await createApiToken(req.tenant, req.body);
      res.status(201).json({
        id: String(token._id),
        name: token.name,
        prefix: token.prefix,
        role: token.role,
        token: plain,
        created_at: iso(token.createdAt),
      });
    }),
  );

  router.delete(
    "/api-tokens/:id",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      await revokeApiToken(req.tenant.tenantId, req.params.id);
      res.status(204).send();
    }),
  );

  router.get(
    "/invoicing-entities",
    asyncHandler(async (req, res) => {
      if (!req.tenant) throw new ForbiddenError("Select a tenant first");
      const entities = await InvoicingEntity.find({ tenantId: req.tenant.tenantId });
      res.json({
        data: entities.map((entity) => ({
          id: String(entity._id),
          name: entity.name,
          legal_name: entity.legalName ?? null,
          tax_id: entity.taxId ?? null,
          default_currency: entity.defaultCurrency,
          net_terms: entity.netTerms,
          is_default: entity.isDefault,
        })),
      });
    }),
  );

  return router;
}
