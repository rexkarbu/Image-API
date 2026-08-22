import { z } from "zod";

/**
 * Server-only Environment Configuration Schema
 *
 * Enforces strong validation on critical runtime variables.
 * Never silently falls back to an insecure secret in production or runtime.
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .url("DATABASE_URL must be a valid connection URL"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters long for security"),
  BETTER_AUTH_URL: z
    .string()
    .min(1, "BETTER_AUTH_URL is required")
    .url("BETTER_AUTH_URL must be a valid URL"),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_APP_URL is required")
    .url("NEXT_PUBLIC_APP_URL must be a valid URL"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

function getEnv(): Env {
  // During CI/build or unit tests without database/auth execution, we support explicit placeholders
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    console.error("❌ Invalid environment variables:\n" + errorDetails);
    throw new Error(
      `Missing or invalid environment configuration. Please check your .env file.\n${errorDetails}`
    );
  }

  return result.data;
}

/**
 * Lazy getter for validated server environment variables.
 * Prevents throwing errors at build time during static analysis if not evaluated.
 */
let cachedEnv: Env | null = null;

export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (!cachedEnv) {
      cachedEnv = getEnv();
    }
    return cachedEnv[prop as keyof Env];
  },
});

export function validateEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = getEnv();
  }
  return cachedEnv;
}
