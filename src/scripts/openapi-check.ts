import SwaggerParser from "@apidevtools/swagger-parser";
import { openApiSpec } from "../lib/openapi/spec";

export async function validateOpenApiDocument(spec: Record<string, unknown>): Promise<void> {
  // 1. Version check
  if (spec.openapi !== "3.1.1") {
    throw new Error(`Invalid OpenAPI version: expected exact '3.1.1', got '${spec.openapi}'`);
  }

  // 2. Info block check
  const info = spec.info as { title?: string; version?: string } | undefined;
  if (!info?.title || !info?.version) {
    throw new Error("OpenAPI spec missing required info.title or info.version");
  }

  // 3. Documented Paths check
  const paths = (spec.paths || {}) as Record<string, any>;
  const requiredPublicPaths = ["/v1/images/transform", "/api/health/live", "/api/health/ready"];
  for (const path of requiredPublicPaths) {
    if (!paths[path]) {
      throw new Error(`OpenAPI spec missing required public path: ${path}`);
    }
  }

  // 4. Internal Route Exclusion Check
  const forbiddenInternalPaths = ["/api/webhooks/stripe", "/api/cron/billing", "/api/auth"];
  for (const path of forbiddenInternalPaths) {
    if (paths[path]) {
      throw new Error(`Security Violation: Internal route ${path} must NOT appear in public OpenAPI spec.`);
    }
  }

  // 5. Inspect /v1/images/transform contract
  const transformPost = paths["/v1/images/transform"]?.post;
  if (!transformPost) {
    throw new Error("POST /v1/images/transform is missing from OpenAPI spec.");
  }

  // Check Idempotency-Key header parameter
  const idempParam = transformPost.parameters?.find((p: any) => p.name?.toLowerCase() === "idempotency-key");
  if (!idempParam || !idempParam.required) {
    throw new Error("POST /v1/images/transform must define required Idempotency-Key header parameter.");
  }
  if (idempParam.schema?.minLength !== 16 || idempParam.schema?.maxLength !== 128) {
    throw new Error("POST /v1/images/transform Idempotency-Key parameter must specify minLength 16 and maxLength 128.");
  }

  // Check multipart request body
  const multipartContent = transformPost.requestBody?.content?.["multipart/form-data"];
  if (!multipartContent || !multipartContent.schema?.properties?.file) {
    throw new Error("POST /v1/images/transform must define multipart/form-data body with binary 'file' property.");
  }

  // Check input format description (no AVIF input)
  const fileDesc = multipartContent.schema?.properties?.file?.description || "";
  if (fileDesc.includes("AVIF input is supported")) {
    throw new Error("OpenAPI must not claim AVIF input support.");
  }

  // Check allowed fit values (cover, contain, inside, fill)
  const fitEnum = multipartContent.schema?.properties?.fit?.enum || [];
  if (fitEnum.includes("outside") || !fitEnum.includes("inside")) {
    throw new Error("Fit enum must include 'inside', 'cover', 'contain', 'fill' and exclude 'outside'.");
  }

  // Check response status codes
  const expectedCodes = ["200", "400", "401", "409", "413", "415", "422", "429", "500", "503"];
  for (const code of expectedCodes) {
    if (!transformPost.responses?.[code]) {
      throw new Error(`POST /v1/images/transform missing response specification for HTTP ${code}`);
    }
  }

  // Check binary response content types on 200
  const success200Content = transformPost.responses?.["200"]?.content;
  if (!success200Content?.["image/webp"] || !success200Content?.["image/jpeg"] || !success200Content?.["image/png"]) {
    throw new Error("POST /v1/images/transform 200 response must specify binary image media types.");
  }

  // Check response headers on 200
  const successHeaders = transformPost.responses?.["200"]?.headers;
  const requiredHeaders = [
    "Content-Type",
    "Content-Length",
    "Content-Disposition",
    "Cache-Control",
    "X-Content-Type-Options",
    "X-Request-ID",
    "X-Usage-Units",
    "X-Image-Width",
    "X-Image-Height",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
  ];
  for (const hdr of requiredHeaders) {
    if (!successHeaders?.[hdr]) {
      throw new Error(`POST /v1/images/transform 200 response missing required header: ${hdr}`);
    }
  }

  // 6. Inspect /api/health/ready security contract
  const readyGet = paths["/api/health/ready"]?.get;
  if (!readyGet) {
    throw new Error("GET /api/health/ready is missing from OpenAPI spec.");
  }
  const readySecurity = readyGet.security;
  if (!Array.isArray(readySecurity) || readySecurity.length !== 1 || !readySecurity[0]?.HealthSecretAuth) {
    throw new Error(
      "GET /api/health/ready security must strictly specify [{ HealthSecretAuth: [] }] without optional empty object."
    );
  }

  // 7. Check for Secret Leakage in Spec JSON
  const rawSpecJson = JSON.stringify(spec);
  if (
    rawSpecJson.includes("img_live_") &&
    !rawSpecJson.includes("img_live_...") // Allow description placeholder format
  ) {
    throw new Error("Security Violation: Real API key detected in OpenAPI spec.");
  }
  if (rawSpecJson.includes("sk_live_") || rawSpecJson.includes("whsec_")) {
    throw new Error("Security Violation: Stripe credentials detected in OpenAPI spec.");
  }

  // 8. Validate through formal OpenAPI Parser / Schema Validator without swallowing errors
  const cloned = JSON.parse(JSON.stringify(spec));
  await SwaggerParser.validate(cloned as any);
}

export async function validateOpenApiSpec(): Promise<void> {
  console.log("=== Validating OpenAPI 3.1.1 Specification ===");
  await validateOpenApiDocument(openApiSpec as any);
  console.log("✅ OpenAPI 3.1.1 specification syntax, schemas, routes, and security rules verified successfully.");
}

if (require.main === module || (typeof process.argv[1] === "string" && process.argv[1].endsWith("openapi-check.ts"))) {
  validateOpenApiSpec()
    .catch((err) => {
      console.error("❌ OpenAPI Check Failed:", (err as Error).message);
      process.exit(1);
    });
}
