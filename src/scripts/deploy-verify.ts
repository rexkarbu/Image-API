import crypto from "node:crypto";

export function validateTargetUrl(rawUrl: string): URL {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Missing target deployment URL argument.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL format: ${rawUrl}`);
  }

  // Reject credentials in URL
  if (parsed.username || parsed.password) {
    throw new Error("Security Violation: URLs with embedded credentials are not permitted.");
  }

  // Reject fragments
  if (parsed.hash) {
    throw new Error("URL must not contain hash fragments.");
  }

  // Enforce HTTPS for remote URLs
  const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (!isLoopback && parsed.protocol !== "https:") {
    throw new Error(`Production/remote deployment URLs must use HTTPS. Received: ${parsed.protocol}`);
  }

  return parsed;
}

export async function runDeployVerify(targetUrlString: string): Promise<void> {
  const targetUrl = validateTargetUrl(targetUrlString);
  const baseUrl = targetUrl.origin;

  console.log(`=== Verifying Deployment at ${baseUrl} ===`);

  // 1. Check Liveness Probe
  console.log("[1/4] Checking GET /api/health/live...");
  const liveRes = await fetch(`${baseUrl}/api/health/live`, {
    headers: { "X-Request-ID": `verify_live_${crypto.randomUUID()}` },
  });
  if (liveRes.status !== 200) {
    throw new Error(`Liveness check failed with status ${liveRes.status}`);
  }
  const liveJson = await liveRes.json();
  if (liveJson.status !== "ok" || liveJson.service !== "image-api") {
    throw new Error(`Unexpected liveness response: ${JSON.stringify(liveJson)}`);
  }
  console.log("✅ Liveness check passed (HTTP 200).");

  // 2. Check Readiness Probe
  console.log("[2/4] Checking GET /api/health/ready...");
  const readyRes = await fetch(`${baseUrl}/api/health/ready`, {
    headers: { "X-Request-ID": `verify_ready_${crypto.randomUUID()}` },
  });
  if (readyRes.status !== 200) {
    const readyBody = await readyRes.text();
    throw new Error(`Readiness check failed with status ${readyRes.status}: ${readyBody}`);
  }
  const readyJson = await readyRes.json();
  if (readyJson.status !== "ready" || readyJson.checks?.database !== "healthy" || readyJson.checks?.redis !== "healthy") {
    throw new Error(`Readiness check reported degraded components: ${JSON.stringify(readyJson)}`);
  }
  console.log("✅ Readiness check passed (HTTP 200 - Database & Redis healthy).");

  // 3. Check OpenAPI JSON
  console.log("[3/4] Checking GET /openapi.json...");
  const openApiRes = await fetch(`${baseUrl}/openapi.json`);
  if (openApiRes.status !== 200) {
    throw new Error(`OpenAPI route failed with status ${openApiRes.status}`);
  }
  const openApiJson = await openApiRes.json();
  if (openApiJson.openapi !== "3.1.1" || !openApiJson.paths?.["/v1/images/transform"]) {
    throw new Error("Invalid OpenAPI 3.1.1 response from deployment.");
  }
  console.log("✅ OpenAPI JSON verified (OpenAPI 3.1.1).");

  // 4. Check Docs Page
  console.log("[4/4] Checking GET /docs...");
  const docsRes = await fetch(`${baseUrl}/docs`);
  if (docsRes.status !== 200) {
    throw new Error(`Docs portal failed with status ${docsRes.status}`);
  }
  const docsHtml = await docsRes.text();
  if (!docsHtml.includes("<!DOCTYPE html>") && !docsHtml.includes("<html")) {
    throw new Error("Docs portal did not return valid HTML.");
  }
  console.log("✅ Interactive Documentation Portal verified (HTTP 200).");

  console.log("\n==================================================");
  console.log("🎉 DEPLOYMENT VERIFICATION PASSED!");
  console.log("==================================================");
}

if (require.main === module || (typeof process.argv[1] === "string" && process.argv[1].endsWith("deploy-verify.ts"))) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const targetArg = args[0];
  if (!targetArg || targetArg.endsWith(".ts")) {
    console.error("Usage: pnpm deploy:verify -- <deployment-url>");
    process.exit(1);
  }

  runDeployVerify(targetArg)
    .catch((err) => {
      console.error("❌ Deployment Verification Failed:", (err as Error).message);
      process.exit(1);
    });
}
