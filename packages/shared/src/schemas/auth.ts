import { z } from "zod";
import { currencySchema, emailSchema, nameSchema, slugSchema } from "./common.js";

export const registerSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(200).regex(/[A-Za-z]/, "must contain a letter").regex(/\d/, "must contain a number"),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(200),
  })
  .strict();

export const refreshSchema = z
  .object({
    refresh_token: z.string().min(10),
  })
  .strict();

export const verifyEmailSchema = z
  .object({
    token: z.string().min(10),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10),
    password: z.string().min(8).max(200).regex(/[A-Za-z]/).regex(/\d/),
  })
  .strict();

export const switchTenantSchema = z
  .object({
    tenant_id: z.string().uuid(),
  })
  .strict();

export const createOrganizationSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema.optional(),
    tenant_name: z.string().trim().min(1).max(200).optional(),
    currency: currencySchema.default("USD"),
  })
  .strict();

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
  })
  .strict();

export const createTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: slugSchema.optional(),
    currency: currencySchema.default("USD"),
  })
  .strict();

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    currency: currencySchema.optional(),
  })
  .strict();

export const inviteMemberSchema = z
  .object({
    email: emailSchema,
    role: z.enum(["admin", "member", "viewer"]),
  })
  .strict();

export const updateMemberSchema = z
  .object({
    role: z.enum(["owner", "admin", "member", "viewer"]),
  })
  .strict();

export const createApiTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.enum(["admin", "member", "viewer"]),
  })
  .strict();

export const acceptInviteSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    password: z.string().min(8).max(200).regex(/[A-Za-z]/).regex(/\d/).optional(),
  })
  .strict();
