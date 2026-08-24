import "./register-server-only";
import * as dotenv from "dotenv";
import { validatePostgresUrlSecurity } from "../db/ssl-validation";
import { validateUpstashRestUrl } from "../lib/ratelimit/redis-safety-core";
import { getValidatedStripeConfig } from "../lib/stripe/safety";
import { validateOpenApiSpec } from "./openapi-check";
import { resolveApplicationOrigin } from "../lib/security/origin";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const HEX_64_REGEX = /^[0-9a-f]{64}$/;
const KNOWN_PLACEHOLDER_REGEX =
  /(?:replace_with|placeholder|example|0000000000000000000000000000000000000000000000000000000000000000)/i;

/**
 * Validates a 64-character lowercase hexadecimal secret (e.g. HEALTHCHECK_SECRET, CRON_SECRET, RATE_LIMIT_IDENTIFIER_SECRET).
 */
export function validateHexSecret(
  name: string,
  secret?: string | null,
  isProductionOrPreview = false
): void {
  if (!isProductionOrPreview) {
    if (!secret || KNOWN_PLACEHOLDER_REGEX.test(secret)) {
      console.log(`ℹ️  ${name} unset/placeholder: Local development permits unauthenticated loopback checks.`);
      return;
    }
  }

  if (!secret) {
    throw new Error(`Preflight Failed: ${name} is required in preview and production environments.`);
  }

  if (typeof secret !== "string" || secret.trim() !== secret) {
    throw new Error(`Preflight Failed: ${name} must not contain leading or trailing whitespace.`);
  }

  if (KNOWN_PLACEHOLDER_REGEX.test(secret)) {
    throw new Error(`Preflight Failed: ${name} contains an unconfigured example placeholder.`);
  }

  if (!HEX_64_REGEX.test(secret)) {
    throw new Error(
      `Preflight Failed: ${name} must be exactly 64 lowercase hexadecimal characters (32 random bytes).`
    );
  }

  const uniqueChars = new Set(secret.split(""));
  if (uniqueChars.size < 8) {
    throw new Error(`Preflight Failed: ${name} entropy is too low (must use 32 random bytes).`);
  }

  console.log(`✅ ${name} format and entropy verified.`);
}

export function validateHealthcheckSecret(
  secret?: string | null,
  isProductionOrPreview = false
): void {
  validateHexSecret("HEALTHCHECK_SECRET", secret, isProductionOrPreview);
}

export function validateCronSecret(
  secret?: string | null,
  isProductionOrPreview = false
): void {
  validateHexSecret("CRON_SECRET", secret, isProductionOrPreview);
}

export function validateBetterAuthSecret(
  secret?: string | null,
  isProductionOrPreview = false
): void {
  if (!isProductionOrPreview) {
    if (!secret || KNOWN_PLACEHOLDER_REGEX.test(secret)) {
      console.log("ℹ️  BETTER_AUTH_SECRET using development placeholder.");
      return;
    }
  }

  if (!secret) {
    throw new Error("Preflight Failed: BETTER_AUTH_SECRET is required in preview and production environments.");
  }

  if (typeof secret !== "string" || secret.trim().length < 32) {
    throw new Error("Preflight Failed: BETTER_AUTH_SECRET must be at least 32 characters long.");
  }

  if (KNOWN_PLACEHOLDER_REGEX.test(secret)) {
    throw new Error("Preflight Failed: BETTER_AUTH_SECRET contains an unconfigured placeholder.");
  }

  console.log("✅ BETTER_AUTH_SECRET format verified.");
}

/**
 * Pure validator for environment variables across deployment stages.
 */
export function validateEnvironmentInvariants(env: Record<string, string | undefined> = process.env): void {
  const isVercel = Boolean(env.VERCEL_ENV);
  const vercelEnv = env.VERCEL_ENV;
  const isProduction = env.NODE_ENV === "production" || vercelEnv === "production";
  const isPreview = vercelEnv === "preview";
  const isProductionOrPreview = isProduction || isPreview;

  // 1. Secrets
  validateBetterAuthSecret(env.BETTER_AUTH_SECRET, isProductionOrPreview);
  validateHealthcheckSecret(env.HEALTHCHECK_SECRET, isProductionOrPreview);
  validateCronSecret(env.CRON_SECRET, isProductionOrPreview);

  if (isProductionOrPreview || env.RATE_LIMIT_IDENTIFIER_SECRET) {
    validateHexSecret(
      "RATE_LIMIT_IDENTIFIER_SECRET",
      env.RATE_LIMIT_IDENTIFIER_SECRET,
      isProductionOrPreview
    );
  }

  // 2. Canonical Application Origin
  resolveApplicationOrigin({ env });

  // 3. Database URLs
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("Preflight Failed: DATABASE_URL is missing.");
  }
  validatePostgresUrlSecurity(dbUrl, "DATABASE_URL");

  // 4. Redis Configuration
  const redisUrl = env.UPSTASH_REDIS_REST_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    throw new Error("Preflight Failed: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");
  }
  validateUpstashRestUrl(redisUrl);
  if (KNOWN_PLACEHOLDER_REGEX.test(redisToken)) {
    throw new Error("Preflight Failed: UPSTASH_REDIS_REST_TOKEN contains a placeholder.");
  }

  // 5. Stripe Test-Mode Safety
  const stripeEnv = env.STRIPE_ENV;
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (stripeEnv !== "test") {
    throw new Error(`Preflight Failed: STRIPE_ENV must be 'test', got '${stripeEnv}'`);
  }
  if (!stripeKey || !stripeKey.startsWith("sk_test_")) {
    throw new Error("Preflight Failed: STRIPE_SECRET_KEY must start with 'sk_test_'.");
  }

  // 6. Environment Isolation Tags
  if (isPreview) {
    if (env.DATABASE_ENV !== "staging") {
      throw new Error(`Preflight Failed: Preview requires DATABASE_ENV='staging', got '${env.DATABASE_ENV}'`);
    }
    if (env.REDIS_ENV !== "staging") {
      throw new Error(`Preflight Failed: Preview requires REDIS_ENV='staging', got '${env.REDIS_ENV}'`);
    }
  }

  if (vercelEnv === "production") {
    if (env.DATABASE_ENV !== "production") {
      throw new Error(`Preflight Failed: Production requires DATABASE_ENV='production', got '${env.DATABASE_ENV}'`);
    }
    if (env.REDIS_ENV !== "production") {
      throw new Error(`Preflight Failed: Production requires REDIS_ENV='production', got '${env.REDIS_ENV}'`);
    }
  }

  // 7. Integration test flags must be false or unset on Vercel
  if (isVercel) {
    if (env.RUN_DB_INTEGRATION_TESTS === "true") {
      throw new Error("Preflight Failed: RUN_DB_INTEGRATION_TESTS must not be enabled in Vercel runtime.");
    }
    if (env.RUN_REDIS_INTEGRATION_TESTS === "true") {
      throw new Error("Preflight Failed: RUN_REDIS_INTEGRATION_TESTS must not be enabled in Vercel runtime.");
    }
    if (env.RUN_STRIPE_INTEGRATION_TESTS === "true") {
      throw new Error("Preflight Failed: RUN_STRIPE_INTEGRATION_TESTS must not be enabled in Vercel runtime.");
    }
  }
}

export async function runDeployPreflight(): Promise<void> {
  console.log("=== Image API Deployment Preflight Verification ===");

  validateEnvironmentInvariants(process.env);

  const directDbUrl = process.env.DIRECT_DATABASE_URL;
  if (directDbUrl) {
    validatePostgresUrlSecurity(directDbUrl, "DIRECT_DATABASE_URL");
    console.log("✅ DIRECT_DATABASE_URL SSL & verify-full security verified.");
  }

  const isBootstrap = Boolean(
    process.env.VERCEL_ENV === "preview" ||
      !process.env.STRIPE_WEBHOOK_SECRET ||
      process.env.STRIPE_WEBHOOK_SECRET.includes("placeholder")
  );
  const stripeConfig = getValidatedStripeConfig({ allowOptionalWebhookSecret: isBootstrap });
  console.log("✅ Stripe test mode & test credentials verified.");

  await validateOpenApiSpec();

  console.log("\n==================================================");
  console.log("🎉 ALL DEPLOYMENT PREFLIGHT CHECKS PASSED!");
  console.log("==================================================");
}

if (
  require.main === module ||
  (typeof process.argv[1] === "string" && process.argv[1].endsWith("deploy-preflight.ts"))
) {
  runDeployPreflight().catch((err) => {
    console.error("❌ Preflight Failed:", (err as Error).message);
    process.exitCode = 1;
  });
}
