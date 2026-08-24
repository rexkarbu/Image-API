import "./register-server-only";
import * as dotenv from "dotenv";
import { validatePostgresUrlSecurity } from "../db/ssl-validation";
import { validateUpstashRestUrl } from "../lib/ratelimit/redis-safety-core";
import { getValidatedStripeConfig } from "../lib/stripe/safety";
import { validateOpenApiSpec } from "./openapi-check";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const HEX_64_REGEX = /^[0-9a-f]{64}$/;
const KNOWN_PLACEHOLDER_REGEX = /(?:replace_with|placeholder|example|0000000000000000000000000000000000000000000000000000000000000000)/i;

/**
 * Validates the HEALTHCHECK_SECRET configuration.
 * Enforces a strong 64-character lowercase hex string in preview/production.
 */
export function validateHealthcheckSecret(
  secret?: string | null,
  isProductionOrPreview = false
): void {
  if (!isProductionOrPreview) {
    if (!secret || KNOWN_PLACEHOLDER_REGEX.test(secret)) {
      console.log("ℹ️  HEALTHCHECK_SECRET unset/placeholder: Local development permits unauthenticated loopback checks.");
      return;
    }
  }

  if (!secret) {
    throw new Error("Preflight Failed: HEALTHCHECK_SECRET is required in preview and production environments.");
  }

  if (typeof secret !== "string" || secret.trim() !== secret) {
    throw new Error("Preflight Failed: HEALTHCHECK_SECRET must not contain leading or trailing whitespace.");
  }

  if (KNOWN_PLACEHOLDER_REGEX.test(secret)) {
    throw new Error("Preflight Failed: HEALTHCHECK_SECRET contains an unconfigured example placeholder.");
  }

  if (!HEX_64_REGEX.test(secret)) {
    throw new Error(
      "Preflight Failed: HEALTHCHECK_SECRET must be exactly 64 lowercase hexadecimal characters (32 random bytes)."
    );
  }

  // Reject degenerate weak secrets (e.g. all identical characters)
  const uniqueChars = new Set(secret.split(""));
  if (uniqueChars.size < 8) {
    throw new Error("Preflight Failed: HEALTHCHECK_SECRET entropy is too low (must use 32 random bytes).");
  }

  console.log("✅ HEALTHCHECK_SECRET format and entropy verified.");
}

export async function runDeployPreflight(): Promise<void> {
  console.log("=== Image API Deployment Preflight Verification ===");

  const isProductionOrPreview =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "production";

  // 1. Validate Healthcheck Secret
  validateHealthcheckSecret(process.env.HEALTHCHECK_SECRET, isProductionOrPreview);

  // 2. Validate Database URLs
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("Preflight Failed: DATABASE_URL is missing.");
  }
  validatePostgresUrlSecurity(dbUrl, "DATABASE_URL");
  console.log("✅ DATABASE_URL SSL & verify-full security verified.");

  const directDbUrl = process.env.DIRECT_DATABASE_URL;
  if (directDbUrl) {
    validatePostgresUrlSecurity(directDbUrl, "DIRECT_DATABASE_URL");
    console.log("✅ DIRECT_DATABASE_URL SSL & verify-full security verified.");
  }

  // 3. Validate Redis Configuration
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    throw new Error("Preflight Failed: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");
  }
  validateUpstashRestUrl(redisUrl);
  console.log("✅ Upstash Redis REST URL endpoint verified.");

  // 4. Validate Stripe Sandbox & Test Mode Safety
  const stripeConfig = getValidatedStripeConfig();
  if (stripeConfig.stripeEnv !== "test") {
    throw new Error(`Preflight Failed: STRIPE_ENV must be 'test', got '${stripeConfig.stripeEnv}'`);
  }
  console.log("✅ Stripe test mode & test credentials verified.");

  // 5. Validate OpenAPI Specification
  await validateOpenApiSpec();

  console.log("\n==================================================");
  console.log("🎉 ALL DEPLOYMENT PREFLIGHT CHECKS PASSED!");
  console.log("==================================================");
}

if (require.main === module || (typeof process.argv[1] === "string" && process.argv[1].endsWith("deploy-preflight.ts"))) {
  runDeployPreflight()
    .catch((err) => {
      console.error("❌ Preflight Failed:", (err as Error).message);
      process.exitCode = 1;
    });
}
