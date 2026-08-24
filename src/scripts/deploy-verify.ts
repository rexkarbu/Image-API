import crypto from "node:crypto";

const MAX_RESPONSE_BYTES = 64 * 1024; // 64 KiB

export function isLoopbackHostname(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "");
  return clean === "localhost" || clean === "127.0.0.1" || clean === "::1";
}

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

  // Reject unsupported protocols
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${parsed.protocol}. Only http: and https: are allowed.`);
  }

  // Reject embedded credentials in URL
  if (parsed.username || parsed.password) {
    throw new Error("Security Violation: URLs with embedded credentials are not permitted.");
  }

  // Reject query strings
  if (parsed.search && parsed.search !== "") {
    throw new Error("Target URL must not contain query parameters.");
  }

  // Reject fragments
  if (parsed.hash && parsed.hash !== "") {
    throw new Error("Target URL must not contain hash fragments.");
  }

  // Reject non-root pathnames
  if (parsed.pathname && parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(`Target URL must be an origin root without path segments. Received pathname: ${parsed.pathname}`);
  }

  // Enforce HTTPS for remote URLs
  const isLoopback = isLoopbackHostname(parsed.hostname);
  if (!isLoopback && parsed.protocol !== "https:") {
    throw new Error(`Production/remote deployment URLs must use HTTPS. Received: ${parsed.protocol}`);
  }

  return parsed;
}

/**
 * Safe fetch with bounded timeout, max response size, and redirect prevention.
 */
export async function safeFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5000
): Promise<{ status: number; text: () => Promise<string>; json: () => Promise<any> }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "manual", // Prevent credential leakage across redirect hops
    });

    return {
      status: res.status,
      text: async () => {
        const reader = res.body?.getReader();
        if (!reader) return "";
        let receivedBytes = 0;
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            receivedBytes += value.length;
            if (receivedBytes > MAX_RESPONSE_BYTES) {
              controller.abort();
              throw new Error("Response body exceeded 64KB maximum size limit.");
            }
            chunks.push(value);
          }
        }
        const total = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const chunk of chunks) {
          total.set(chunk, offset);
          offset += chunk.length;
        }
        return new TextDecoder().decode(total);
      },
      json: async () => {
        const text = await (await fetch(url, { ...options, signal: controller.signal, redirect: "manual" })).text();
        return JSON.parse(text);
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runDeployVerify(targetUrlString: string): Promise<void> {
  const targetUrl = validateTargetUrl(targetUrlString);
  const baseUrl = targetUrl.origin;

  console.log(`=== Verifying Deployment at ${baseUrl} ===`);

  // Build headers with optional healthcheck secret for production readiness
  const headers: Record<string, string> = {
    "X-Request-ID": `verify_${crypto.randomUUID()}`,
  };

  const healthSecret = process.env.HEALTHCHECK_SECRET;
  if (healthSecret && /^[0-9a-f]{64}$/.test(healthSecret)) {
    headers["Authorization"] = `Bearer ${healthSecret}`;
  }

  // 1. Check Liveness Probe
  console.log("[1/4] Checking GET /api/health/live...");
  const liveRes = await safeFetch(`${baseUrl}/api/health/live`, { headers });
  if (liveRes.status !== 200) {
    throw new Error(`Liveness check failed with status ${liveRes.status}`);
  }
  const liveJson = await liveRes.json();
  if (liveJson.status !== "ok" || liveJson.service !== "image-api") {
    throw new Error("Unexpected liveness payload response.");
  }
  console.log("✅ Liveness check passed (HTTP 200).");

  // 2. Check Readiness Probe
  console.log("[2/4] Checking GET /api/health/ready...");
  const readyRes = await safeFetch(`${baseUrl}/api/health/ready`, { headers });
  if (readyRes.status !== 200) {
    throw new Error(`Readiness check failed with status ${readyRes.status}`);
  }
  const readyJson = await readyRes.json();
  if (readyJson.status !== "ready" || readyJson.checks?.database !== "healthy" || readyJson.checks?.redis !== "healthy") {
    throw new Error("Readiness check reported degraded components.");
  }
  console.log("✅ Readiness check passed (HTTP 200 - Database & Redis healthy).");

  // 3. Check OpenAPI JSON
  console.log("[3/4] Checking GET /openapi.json...");
  const openApiRes = await safeFetch(`${baseUrl}/openapi.json`);
  if (openApiRes.status !== 200) {
    throw new Error(`OpenAPI route failed with status ${openApiRes.status}`);
  }
  const openApiJson = await openApiRes.json();
  if (!openApiJson.openapi?.startsWith("3.1.") || !openApiJson.paths?.["/v1/images/transform"]) {
    throw new Error("Invalid OpenAPI 3.1 response from deployment.");
  }
  console.log("✅ OpenAPI JSON verified (OpenAPI 3.1).");

  // 4. Check Docs Page
  console.log("[4/4] Checking GET /docs...");
  const docsRes = await safeFetch(`${baseUrl}/docs`);
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
    process.exitCode = 1;
  } else {
    runDeployVerify(targetArg).catch((err) => {
      console.error("❌ Deployment Verification Failed:", (err as Error).message);
      process.exitCode = 1;
    });
  }
}
