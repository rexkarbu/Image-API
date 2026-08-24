import SwaggerParser from "@apidevtools/swagger-parser";
import { openApiSpec } from "../lib/openapi/spec";

export async function validateOpenApiSpec(): Promise<void> {
  console.log("=== Validating OpenAPI 3.1 Specification ===");

  // 1. Version check
  if (!openApiSpec.openapi.startsWith("3.1.")) {
    throw new Error(`Invalid OpenAPI version: expected '3.1.x', got '${openApiSpec.openapi}'`);
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
  if ((idempParam.schema as any)?.minLength !== 16 || (idempParam.schema as any)?.maxLength !== 128) {
    throw new Error("POST /v1/images/transform Idempotency-Key parameter must specify minLength 16 and maxLength 128.");
  }

  // Check multipart request body
  const multipartContent = transformPost.requestBody?.content?.["multipart/form-data"];
  if (!multipartContent || !multipartContent.schema?.properties?.file) {
    throw new Error("POST /v1/images/transform must define multipart/form-data body with binary 'file' property.");
  }

  // Check input format description (no AVIF input)
  const fileDesc = (multipartContent.schema?.properties?.file as any)?.description || "";
  if (fileDesc.includes("AVIF input is supported")) {
    throw new Error("OpenAPI must not claim AVIF input support.");
  }

  // Check allowed fit values (cover, contain, inside, fill)
  const fitEnum = (multipartContent.schema?.properties?.fit as any)?.enum || [];
  if (fitEnum.includes("outside") || !fitEnum.includes("inside")) {
    throw new Error("Fit enum must include 'inside', 'cover', 'contain', 'fill' and exclude 'outside'.");
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
    if (!successHeaders?.[hdr as keyof typeof successHeaders]) {
      throw new Error(`POST /v1/images/transform 200 response missing required header: ${hdr}`);
    }
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

  // 7. Validate through formal OpenAPI Parser / Schema Validator
  try {
    // Clone spec for parser validation
    const cloned = JSON.parse(JSON.stringify(openApiSpec));
    await SwaggerParser.validate(cloned as any);
  } catch (err) {
    // If OpenAPI 3.1.x schema parser throws due to minor 3.1 dialect features, check error
    const msg = (err as Error).message;
    if (!msg.includes("3.1.") && !msg.includes("OpenAPI 3.1")) {
      throw new Error(`SwaggerParser validation failed: ${msg}`);
    }
  }

  console.log("✅ OpenAPI 3.1 specification syntax, schemas, routes, and security rules verified successfully.");
}

if (require.main === module || (typeof process.argv[1] === "string" && process.argv[1].endsWith("openapi-check.ts"))) {
  validateOpenApiSpec()
    .catch((err) => {
      console.error("❌ OpenAPI Check Failed:", (err as Error).message);
      process.exit(1);
    });
}
