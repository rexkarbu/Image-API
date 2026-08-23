"use server";

import { requireOrganizationContext } from "@/lib/tenant/context";
import { canManageApiKeys } from "@/lib/crypto/api-keys";
import {
  createApiKeyInputSchema,
  apiKeyIdSchema,
  rotateApiKeyInputSchema,
  ApiKeyRotationMode,
} from "@/lib/validations/api-keys";
import {
  createApiKey,
  revokeApiKey,
  rotateApiKey,
  ApiKeyServiceError,
} from "@/lib/services/api-keys";
import {
  ApiKeyDto,
  CreateApiKeyResult,
  RotateApiKeyResult,
  ActionResult,
} from "@/types/api-keys";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";

export type { ActionResult };

function handleActionError(err: unknown, operationName: string): ActionResult<never> {
  if (err instanceof ApiKeyServiceError) {
    return {
      success: false,
      code: err.code,
      error: err.message,
    };
  }

  // Generate safe correlation ID for server-side troubleshooting without leaking details to client
  const correlationId = crypto.randomUUID();
  console.error(`[ServerAction Error] correlationId=${correlationId} operation=${operationName}`);

  return {
    success: false,
    code: "INTERNAL_ERROR",
    error: "An unexpected internal error occurred. Please try again later.",
  };
}

export async function createApiKeyAction(
  _prevState: ActionResult<CreateApiKeyResult> | null,
  formData: FormData
): Promise<ActionResult<CreateApiKeyResult>> {
  // 1. Resolve trusted context outside mutation try/catch to let Next.js redirect exceptions propagate
  const context = await requireOrganizationContext();

  // 2. Authorize role
  if (!canManageApiKeys(context.membership.role)) {
    return {
      success: false,
      code: "FORBIDDEN",
      error: "Forbidden: You do not have permission to create API keys in this organization.",
    };
  }

  // 3. Validate input
  const rawName = formData.get("name");
  const rawScopes = formData.get("scopes") || "image:transform";

  const parsed = createApiKeyInputSchema.safeParse({
    name: rawName,
    scopes: rawScopes,
  });

  if (!parsed.success) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: parsed.error.issues[0]?.message || "Invalid API key parameters.",
    };
  }

  // 4. Execute mutation with safe boundary
  try {
    const result = await createApiKey(
      {
        organizationId: context.organization.id,
        userId: context.user.id,
        role: context.membership.role,
      },
      parsed.data
    );

    revalidatePath("/dashboard/api-keys");
    revalidatePath("/dashboard");

    return {
      success: true,
      data: result,
    };
  } catch (err) {
    return handleActionError(err, "createApiKey");
  }
}

export async function revokeApiKeyAction(keyId: string): Promise<ActionResult<ApiKeyDto>> {
  // 1. Resolve trusted context outside mutation try/catch
  const context = await requireOrganizationContext();

  // 2. Authorize role
  if (!canManageApiKeys(context.membership.role)) {
    return {
      success: false,
      code: "FORBIDDEN",
      error: "Forbidden: You do not have permission to revoke API keys in this organization.",
    };
  }

  // 3. Validate input
  const parsedId = apiKeyIdSchema.safeParse(keyId);
  if (!parsedId.success) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Invalid API key identifier.",
    };
  }

  // 4. Execute mutation with safe boundary
  try {
    const revokedKey = await revokeApiKey(
      {
        organizationId: context.organization.id,
        userId: context.user.id,
        role: context.membership.role,
      },
      parsedId.data
    );

    revalidatePath("/dashboard/api-keys");
    revalidatePath("/dashboard");

    return {
      success: true,
      data: revokedKey,
    };
  } catch (err) {
    return handleActionError(err, "revokeApiKey");
  }
}

export async function rotateApiKeyAction(
  keyId: string,
  mode: ApiKeyRotationMode
): Promise<ActionResult<RotateApiKeyResult>> {
  // 1. Resolve trusted context outside mutation try/catch
  const context = await requireOrganizationContext();

  // 2. Authorize role
  if (!canManageApiKeys(context.membership.role)) {
    return {
      success: false,
      code: "FORBIDDEN",
      error: "Forbidden: You do not have permission to rotate API keys in this organization.",
    };
  }

  // 3. Validate input
  const parsed = rotateApiKeyInputSchema.safeParse({ keyId, mode });
  if (!parsed.success) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: parsed.error.issues[0]?.message || "Invalid rotation parameters.",
    };
  }

  // 4. Execute mutation with safe boundary
  try {
    const result = await rotateApiKey(
      {
        organizationId: context.organization.id,
        userId: context.user.id,
        role: context.membership.role,
      },
      parsed.data.keyId,
      parsed.data.mode
    );

    revalidatePath("/dashboard/api-keys");
    revalidatePath("/dashboard");

    return {
      success: true,
      data: result,
    };
  } catch (err) {
    return handleActionError(err, "rotateApiKey");
  }
}
