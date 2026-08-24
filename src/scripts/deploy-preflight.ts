import "./register-server-only";
import * as dotenv from "dotenv";
import { validatePostgresUrlSecurity } from "../db/ssl-validation";
import { validateUpstashRestUrl } from "../lib/ratelimit/redis-safety-core";
import { getValidatedStripeConfig } from "../lib/stripe/safety";
import { validateOpenApiSpec } from "./openapi-check";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export function runDeployPreflight(): void {
  console.log("=== Image API Deployment Preflight Verification ===");

  // 1. Validate Database URLs
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

  // 2. Validate Redis Configuration
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    throw new Error("Preflight Failed: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");
  }
  validateUpstashRestUrl(redisUrl);
  console.log("✅ Upstash Redis REST URL endpoint verified.");

  // 3. Validate Stripe Sandbox & Test Mode Safety
  const stripeConfig = getValidatedStripeConfig();
  if (stripeConfig.stripeEnv !== "test") {
    throw new Error(`Preflight Failed: STRIPE_ENV must be 'test', got '${stripeConfig.stripeEnv}'`);
  }
  console.log("✅ Stripe test mode & test credentials verified.");

  // 4. Validate OpenAPI Specification
  validateOpenApiSpec();

  console.log("\n==================================================");
  console.log("🎉 ALL DEPLOYMENT PREFLIGHT CHECKS PASSED!");
  console.log("==================================================");
}

if (require.main === module || (typeof process.argv[1] === "string" && process.argv[1].endsWith("deploy-preflight.ts"))) {
  try {
    runDeployPreflight();
  } catch (err) {
    console.error("❌ Preflight Failed:", (err as Error).message);
    process.exit(1);
  }
}
