import crypto from "node:crypto";
import { normalizeIp, deriveIpIdentifier, deriveApiKeyIdentifier } from "../security/rate-limit-core";

/**
 * Constructs a unique, valid RFC 5952 / RFC 3849 IPv6 address within the documentation prefix 2001:db8::/32.
 */
export function createDocumentationIpv6(): string {
  const groups = crypto.randomBytes(12).toString("hex").match(/.{4}/g);

  if (!groups || groups.length !== 6) {
    throw new Error("Failed to construct isolated E2E client identity.");
  }

  return `2001:db8:${groups.join(":")}`;
}

export interface IsolatedE2EClientIps {
  ordinaryClientIp: string;
  floodClientIp: string;
}

/**
 * Generates two independent, distinct, canonical IPv6 addresses for E2E testing:
 * - ordinaryClientIp: for all standard and edge-case transformation requests (Steps 2-7).
 * - floodClientIp: for deliberate IP-level rate-limit exhaustion (Step 8).
 */
export function generateIsolatedE2EClientIps(): IsolatedE2EClientIps {
  const rawOrdinary = createDocumentationIpv6();
  let rawFlood = createDocumentationIpv6();

  while (rawFlood === rawOrdinary) {
    rawFlood = createDocumentationIpv6();
  }

  const ordinaryClientIp = normalizeIp(rawOrdinary);
  const floodClientIp = normalizeIp(rawFlood);

  if (!ordinaryClientIp || !floodClientIp || ordinaryClientIp === floodClientIp) {
    throw new Error("Failed to initialize distinct canonical E2E client IPs.");
  }

  return {
    ordinaryClientIp,
    floodClientIp,
  };
}

export interface E2EHeaderOptions {
  clientIp: string;
  authorization?: string;
  idempotencyKey?: string;
  contentType?: string;
  contentLength?: string | number;
  customHeaders?: Record<string, string>;
}

/**
 * Builds HTTP headers for E2E requests, guaranteeing that `x-forwarded-for` is injected
 * with the exact isolated test client IP and cannot be overridden by caller-provided headers.
 */
export function buildE2ERequestHeaders(options: E2EHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "x-forwarded-for": options.clientIp,
  };

  if (options.authorization !== undefined) {
    headers["Authorization"] = options.authorization;
  }

  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  if (options.contentType !== undefined) {
    headers["Content-Type"] = options.contentType;
  }

  if (options.contentLength !== undefined) {
    headers["Content-Length"] = String(options.contentLength);
  }

  if (options.customHeaders) {
    for (const [k, v] of Object.entries(options.customHeaders)) {
      // Do not allow caller-provided headers to accidentally override the isolated client IP
      if (k.toLowerCase() === "x-forwarded-for") continue;
      headers[k] = v;
    }
  }

  return headers;
}

export interface E2ECleanupIdentifiers {
  keyIdentifier: string;
  ordinaryIpIdentifier: string;
  floodIpIdentifier: string;
}

/**
 * Derives the exact 3 privacy-preserving HMAC cleanup identifiers registered for an E2E run:
 * 1. Active API key identifier
 * 2. Ordinary client IP identifier
 * 3. Flood client IP identifier
 */
export function deriveE2ECleanupIdentifiers(
  organizationId: string,
  apiKeyId: string,
  ordinaryIp: string,
  floodIp: string,
  secret?: string
): E2ECleanupIdentifiers {
  return {
    keyIdentifier: deriveApiKeyIdentifier(organizationId, apiKeyId, secret),
    ordinaryIpIdentifier: deriveIpIdentifier(ordinaryIp, secret),
    floodIpIdentifier: deriveIpIdentifier(floodIp, secret),
  };
}
