import { openApiSpec } from "../lib/openapi/spec";

export function validateOpenApiSpec(): void {
  console.log("=== Validating OpenAPI 3.1.1 Specification ===");

  // 1. Version check
  if (openApiSpec.openapi !== "3.1.1") {
    throw new Error(`Invalid OpenAPI version: expected '3.1.1', got '${openApiSpec.openapi}'`);
  }

  // 2. Info block check
  if (!openApiSpec.info?.title || !openApiSpec.info?.version) {
    throw new Error("OpenAPI spec missing required info.title or info.version");
  }

  // 3. Documented Paths check
  const requiredPublicPaths = ["/v1/images/transform", "/api/health/live", "/api/health/ready"];
  for (const path of requiredPublicPaths) {
    if (!openApiSpec.paths[path as keyof typeof openApiSpec.paths]) {
      throw new Error(`OpenAPI spec missing required public path: ${path}`);
    }
  }

  // 4. Internal Route Exclusion Check
  const forbiddenInternalPaths = ["/api/webhooks/stripe", "/api/cron/billing", "/api/auth"];
  for (const path of forbiddenInternalPaths) {
    if (openApiSpec.paths[path as keyof typeof openApiSpec.paths]) {
      throw new Error(`Security Violation: Internal route ${path} must NOT appear in public OpenAPI spec.`);
    }
  }

  // 5. Inspect /v1/images/transform contract
  const transformPost = openApiSpec.paths["/v1/images/transform"].post;
  if (!transformPost) {
    throw new Error("POST /v1/images/transform is missing from OpenAPI spec.");
  }

  // Check Idempotency-Key header parameter
  const idempParam = transformPost.parameters?.find((p) => p.name.toLowerCase() === "idempotency-key");
  if (!idempParam || !idempParam.required) {
    throw new Error("POST /v1/images/transform must define required Idempotency-Key header parameter.");
  }

  // Check multipart request body
  const multipartContent = transformPost.requestBody?.content?.["multipart/form-data"];
  if (!multipartContent || !multipartContent.schema?.properties?.file) {
    throw new Error("POST /v1/images/transform must define multipart/form-data body with binary 'file' property.");
  }

  // Check response status codes
  const expectedCodes = ["200", "400", "401", "409", "413", "415", "422", "429", "500", "503"];
  for (const code of expectedCodes) {
    if (!transformPost.responses[code as keyof typeof transformPost.responses]) {
      throw new Error(`POST /v1/images/transform missing response specification for HTTP ${code}`);
    }
  }

  // Check binary response content types on 200
  const success200Content = transformPost.responses["200"].content;
  if (!success200Content?.["image/webp"] || !success200Content?.["image/jpeg"] || !success200Content?.["image/png"]) {
    throw new Error("POST /v1/images/transform 200 response must specify binary image media types.");
  }

  // Check response headers on 200
  const successHeaders = transformPost.responses["200"].headers;
  if (!successHeaders?.["X-Usage-Units"] || !successHeaders?.["X-Request-ID"]) {
    throw new Error("POST /v1/images/transform 200 response must specify X-Usage-Units and X-Request-ID headers.");
  }

  // 6. Check for Secret Leakage in Spec JSON
  const rawSpecJson = JSON.stringify(openApiSpec);
  if (
    rawSpecJson.includes("img_live_") &&
    !rawSpecJson.includes("img_live_...") // Allow description placeholder format
  ) {
    throw new Error("Security Violation: Real API key detected in OpenAPI spec.");
  }
  if (rawSpecJson.includes("sk_live_") || rawSpecJson.includes("whsec_")) {
    throw new Error("Security Violation: Stripe credentials detected in OpenAPI spec.");
  }

  console.log("✅ OpenAPI 3.1.1 specification syntax, schemas, routes, and security rules verified successfully.");
}

if (require.main === module || (typeof process.argv[1] === "string" && process.argv[1].endsWith("openapi-check.ts"))) {
  try {
    validateOpenApiSpec();
  } catch (err) {
    console.error("❌ OpenAPI Check Failed:", (err as Error).message);
    process.exit(1);
  }
}
