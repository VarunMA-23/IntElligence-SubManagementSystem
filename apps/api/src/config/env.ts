import "dotenv/config";
import { z } from "zod";

const booleanish = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  WEB_ORIGIN: z.string().default("http://localhost:8080"),
  MONGODB_URI: z.string().default("mongodb://localhost:27017/brightloop"),
  MONGODB_DB: z.string().optional(),
  USE_MEMORY_DB: booleanish,
  JWT_SECRET: z.string().min(8).default("brightloop-local-development-secret"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  MAILER_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
  MAILER_SMTP_HOST: z.string().default("localhost"),
  MAILER_SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAILER_FROM: z.string().default("BrightLoop <no-reply@brightloop.local>"),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  ALLOW_LOCAL_WEBHOOKS: booleanish,
  INTERNAL_SECRET: z.string().min(8).default("local-internal-secret"),
  PORTAL_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
  STORAGE_DIR: z.string().default("./storage"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, unknown>> = {}): AppConfig {
  const merged = { ...process.env, ...overrides } as Record<string, unknown>;
  if (merged.NODE_ENV === "test" && merged.ALLOW_LOCAL_WEBHOOKS === undefined) {
    merged.ALLOW_LOCAL_WEBHOOKS = "true";
  }
  const result = envSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}
