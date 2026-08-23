/**
 * Pure type-only definitions for client-safe API key DTOs and action results.
 * MUST NOT import any server, database, or cryptographic libraries.
 */

export type DerivedApiKeyStatus = "active" | "expired" | "revoked";

export type ApiKeyErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "NOT_FOUND_OR_UNAVAILABLE"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export interface ApiKeyDto {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  displayPrefix: string;
  scopes: string;
  status: DerivedApiKeyStatus;
  rawStatus: "active" | "revoked";
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserName?: string | null;
}

export interface CreateApiKeyResult {
  key: ApiKeyDto;
  plaintextKey: string;
}

export interface RotateApiKeyResult {
  newKey: ApiKeyDto;
  oldKey: ApiKeyDto;
  plaintextKey: string;
}

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: ApiKeyErrorCode;
}
