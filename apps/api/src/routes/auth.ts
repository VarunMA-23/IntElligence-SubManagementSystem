import { Router, type RequestHandler } from "express";
import {
  acceptInviteSchema,
  ConflictError,
  createOrganizationSchema,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  forgotPasswordSchema,
  loginSchema,
  newOpaqueToken,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  sha256,
  switchTenantSchema,
  verifyEmailSchema,
} from "@brightloop/shared";
import { RefreshToken, Tenant, User } from "@brightloop/db";
import { createEmailAdapter } from "@brightloop/integrations";
import type { AppConfig } from "../config/env.js";
import { asyncHandler } from "../lib/http.js";
import { serializeUser } from "../lib/serializers.js";
import { validate } from "../middleware/validate.js";
import {
  createRefreshToken,
  createUser,
  hashPassword,
  issueAccessToken,
  primaryTenantForUser,
  requireMembership,
  rotateRefreshToken,
  verifyPassword,
} from "../services/auth-service.js";
import { acceptInvite, createOrganization, listUserOrganizations } from "../services/organization-service.js";

const emailAdapter = (config: AppConfig) =>
  createEmailAdapter({
    transport: config.MAILER_TRANSPORT,
    from: config.MAILER_FROM,
    smtpHost: config.MAILER_SMTP_HOST,
    smtpPort: config.MAILER_SMTP_PORT,
  });

async function sessionForUser(config: AppConfig, user: any) {
  let context: { orgId: string; tenantId: string; role: any } | null = null;
  try {
    context = await primaryTenantForUser(String(user._id));
  } catch {
    context = null;
  }
  const access = issueAccessToken(config, {
    userId: String(user._id),
    orgId: context?.orgId ?? "",
    tenantId: context?.tenantId ?? "",
    role: context?.role ?? "owner",
  });
  const refresh = await createRefreshToken(config, {
    userId: String(user._id),
    orgId: context?.orgId ?? null,
    tenantId: context?.tenantId ?? null,
  });
  return {
    access_token: access,
    refresh_token: refresh.plain,
    expires_in: 900,
    user: serializeUser(user),
    org_id: context?.orgId ?? null,
    tenant_id: context?.tenantId ?? null,
    role: context?.role ?? null,
  };
}

export function authRoutes(config: AppConfig, authenticate: RequestHandler) {
  const router = Router();
  const mailer = emailAdapter(config);

  router.post(
    "/register",
    validate({ body: registerSchema }),
    asyncHandler(async (req, res) => {
      const body = req.body as any;
      const { user, existing } = await createUser(body);
      if (existing) throw new ConflictError("An account with this email already exists");
      const verifyToken = newOpaqueToken(32);
      user.verificationTokenHash = sha256(verifyToken);
      await user.save();
      await mailer.send({
        to: user.email,
        subject: "Verify your BrightLoop email",
        text: `Verify your BrightLoop account: ${config.WEB_ORIGIN}/verify-email?token=${verifyToken}`,
      });
      res.status(201).json({
        user: serializeUser(user),
        verification_required: true,
        verification_token_hint: config.NODE_ENV === "test" || config.MAILER_TRANSPORT === "console" ? verifyToken : undefined,
      });
    }),
  );

  router.post(
    "/verify-email",
    validate({ body: verifyEmailSchema }),
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ verificationTokenHash: sha256(req.body.token) });
      if (!user) throw new NotFoundError("Verification token");
      user.emailVerifiedAt = new Date();
      user.verificationTokenHash = null;
      await user.save();
      res.json({ verified: true });
    }),
  );

  router.post(
    "/login",
    validate({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      const body = req.body as any;
      const user = await User.findOne({ email: body.email });
      if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
        throw new UnauthorizedError("Invalid email or password");
      }
      if (!user.emailVerifiedAt) throw new ForbiddenError("Email verification is required");
      res.json(await sessionForUser(config, user));
    }),
  );

  router.post(
    "/refresh",
    validate({ body: refreshSchema }),
    asyncHandler(async (req, res) => {
      const rotated = await rotateRefreshToken(config, req.body.refresh_token);
      const user = await User.findById(rotated.userId);
      if (!user) throw new UnauthorizedError("Invalid refresh token");
      const access = issueAccessToken(config, {
        userId: rotated.userId,
        orgId: rotated.orgId,
        tenantId: rotated.tenantId,
        role: rotated.role,
      });
      res.json({
        access_token: access,
        refresh_token: rotated.refresh.plain,
        expires_in: 900,
        user: serializeUser(user),
        org_id: rotated.orgId,
        tenant_id: rotated.tenantId,
        role: rotated.role,
      });
    }),
  );

  router.post(
    "/forgot-password",
    validate({ body: forgotPasswordSchema }),
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ email: req.body.email });
      if (user) {
        const token = newOpaqueToken(32);
        user.resetTokenHash = sha256(token);
        user.resetExpiresAt = new Date(Date.now() + 3_600_000);
        await user.save();
        await mailer.send({
          to: user.email,
          subject: "Reset your BrightLoop password",
          text: `Reset your BrightLoop password: ${config.WEB_ORIGIN}/reset-password?token=${token}`,
        });
      }
      res.json({ submitted: true });
    }),
  );

  router.post(
    "/reset-password",
    validate({ body: resetPasswordSchema }),
    asyncHandler(async (req, res) => {
      const user = await User.findOne({
        resetTokenHash: sha256(req.body.token),
        resetExpiresAt: { $gt: new Date() },
      });
      if (!user) throw new UnauthorizedError("Reset token is invalid or expired");
      user.passwordHash = await hashPassword(req.body.password);
      user.resetTokenHash = null;
      user.resetExpiresAt = null;
      await user.save();
      await RefreshToken.updateMany({ userId: String(user._id), revokedAt: null }, { $set: { revokedAt: new Date() } });
      res.json({ reset: true });
    }),
  );

  router.post(
    "/invites/accept",
    validate({ body: acceptInviteSchema }),
    asyncHandler(async (req, res) => {
      const result = await acceptInvite(req.body);
      const access = issueAccessToken(config, {
        userId: String(result.user._id),
        orgId: result.orgId,
        tenantId: result.tenantId,
        role: result.role,
      });
      const refresh = await createRefreshToken(config, {
        userId: String(result.user._id),
        orgId: result.orgId,
        tenantId: result.tenantId,
      });
      res.json({
        access_token: access,
        refresh_token: refresh.plain,
        expires_in: 900,
        user: serializeUser(result.user),
        org_id: result.orgId,
        tenant_id: result.tenantId,
        role: result.role,
      });
    }),
  );

  router.post("/switch-tenant", authenticate,
    validate({ body: switchTenantSchema }),
    asyncHandler(async (req, res) => {
      const userId = req.auth?.userId;
      if (!userId) throw new UnauthorizedError();
      const tenant = await Tenant.findById(req.body.tenant_id);
      if (!tenant) throw new NotFoundError("Tenant");
      const membership = await requireMembership(userId, tenant.orgId);
      const access = issueAccessToken(config, {
        userId,
        orgId: tenant.orgId,
        tenantId: String(tenant._id),
        role: membership.role as any,
      });
      const refresh = await createRefreshToken(config, {
        userId,
        orgId: tenant.orgId,
        tenantId: String(tenant._id),
      });
      res.json({ access_token: access, refresh_token: refresh.plain, expires_in: 900, tenant_id: String(tenant._id) });
    }),
  );

  router.get("/me", authenticate,
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      const user = await User.findById(req.auth.userId);
      if (!user) throw new UnauthorizedError();
      res.json({ user: serializeUser(user), organizations: await listUserOrganizations(String(user._id)) });
    }),
  );

  router.post("/organizations", authenticate, validate({ body: createOrganizationSchema }),
    asyncHandler(async (req, res) => {
      if (!req.auth?.userId) throw new UnauthorizedError();
      const user = await User.findById(req.auth.userId);
      if (!user) throw new UnauthorizedError();
      if (!user.emailVerifiedAt) throw new ForbiddenError("Email verification is required");
      const result = await createOrganization(req.auth.userId, req.body);
      const access = issueAccessToken(config, {
        userId: req.auth.userId,
        orgId: String(result.org._id),
        tenantId: String(result.tenant._id),
        role: "owner",
      });
      const refresh = await createRefreshToken(config, {
        userId: req.auth.userId,
        orgId: String(result.org._id),
        tenantId: String(result.tenant._id),
      });
      res.status(201).json({
        organization: { id: String(result.org._id), name: result.org.name, slug: result.org.slug },
        tenant: {
          id: String(result.tenant._id),
          name: result.tenant.name,
          slug: result.tenant.slug,
          currency: result.tenant.currency,
        },
        access_token: access,
        refresh_token: refresh.plain,
        expires_in: 900,
      });
    }),
  );
  return router;
}

