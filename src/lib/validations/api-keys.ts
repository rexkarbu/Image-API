import { z } from "zod";

// Disallow control characters (\x00-\x1F, \x7F) and newlines in key names
const noControlCharsRegex = /^[^\x00-\x1F\x7F]+$/;

export const apiKeyNameSchema = z
  .string()
  .trim()
  .min(2, { message: "API key name must be at least 2 characters long." })
  .max(64, { message: "API key name must be at most 64 characters long." })
  .regex(noControlCharsRegex, { message: "API key name cannot contain control characters." });

export const apiKeyIdSchema = z
  .string()
  .trim()
  .min(1, { message: "API key ID is required." });

export const apiKeyStatusFilterSchema = z
  .enum(["all", "active", "expired", "revoked"])
  .default("all");

export type ApiKeyStatusFilter = z.infer<typeof apiKeyStatusFilterSchema>;

export const apiKeyRotationModeSchema = z.enum(["immediate", "grace_24h"]);

export type ApiKeyRotationMode = z.infer<typeof apiKeyRotationModeSchema>;

export const createApiKeyInputSchema = z.object({
  name: apiKeyNameSchema,
  scopes: z.enum(["image:transform"]).default("image:transform"),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;

export const rotateApiKeyInputSchema = z.object({
  keyId: apiKeyIdSchema,
  mode: apiKeyRotationModeSchema,
});

export type RotateApiKeyInput = z.infer<typeof rotateApiKeyInputSchema>;

export const revokeApiKeyInputSchema = z.object({
  keyId: apiKeyIdSchema,
});

export type RevokeApiKeyInput = z.infer<typeof revokeApiKeyInputSchema>;
