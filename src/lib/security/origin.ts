export interface OriginResolutionOptions {
  env?: Record<string, string | undefined>;
  isClient?: boolean;
}

export function isLoopbackHostname(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "");
  return clean === "localhost" || clean === "127.0.0.1" || clean === "::1";
}

/**
 * Validates and normalizes an application origin URL.
 * Enforces HTTPS for remote environments and rejects query strings, fragments, pathnames, and credentials.
 */
export function sanitizeAndValidateOrigin(
  rawUrl: string,
  isDeployedVercel = false
): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Origin resolution failed: empty or invalid URL provided.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Origin resolution failed: malformed URL format.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Origin resolution failed: only http: and https: protocols are permitted.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Origin resolution failed: URLs with embedded credentials are not permitted.");
  }

  if (parsed.search && parsed.search !== "") {
    throw new Error("Origin resolution failed: URL must not contain query parameters.");
  }

  if (parsed.hash && parsed.hash !== "") {
    throw new Error("Origin resolution failed: URL must not contain hash fragments.");
  }

  if (parsed.pathname && parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("Origin resolution failed: URL must be an origin root without path segments.");
  }

  const isLoopback = isLoopbackHostname(parsed.hostname);
  if (!isLoopback && parsed.protocol !== "https:") {
    throw new Error("Origin resolution failed: remote Preview and Production URLs must use HTTPS.");
  }

  if (isLoopback && isDeployedVercel) {
    throw new Error(
      "Origin resolution failed: loopback origins are not permitted in deployed Vercel environments."
    );
  }

  return parsed.origin;
}

/**
 * Pure, centralized resolver for application canonical origin.
 * Strictly distinguishes local development from remote Preview and Production environments.
 */
export function resolveApplicationOrigin(options: OriginResolutionOptions = {}): string {
  const env = options.env || process.env;
  const vercelEnv = env.VERCEL_ENV;
  const isDeployedVercel = Boolean(vercelEnv && vercelEnv !== "development");

  // 1. Explicitly configured canonical origins take highest precedence
  const explicitCandidate =
    env.BETTER_AUTH_URL ||
    env.NEXT_PUBLIC_APP_URL ||
    env.APP_URL;

  if (explicitCandidate && explicitCandidate.trim() !== "") {
    return sanitizeAndValidateOrigin(explicitCandidate.trim(), isDeployedVercel);
  }

  // 2. Vercel System Environment Variables (Production & Preview)
  if (vercelEnv === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return sanitizeAndValidateOrigin(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`, true);
  }

  if (vercelEnv === "preview") {
    if (env.VERCEL_BRANCH_URL) {
      return sanitizeAndValidateOrigin(`https://${env.VERCEL_BRANCH_URL}`, true);
    }
    if (env.VERCEL_URL) {
      return sanitizeAndValidateOrigin(`https://${env.VERCEL_URL}`, true);
    }
  }

  // 3. Fallback for Local Development, Local Builds & In-Memory Tests Only
  if (!isDeployedVercel) {
    return "http://localhost:3000";
  }

  throw new Error("Production Configuration Error: Canonical application origin is not configured.");
}
