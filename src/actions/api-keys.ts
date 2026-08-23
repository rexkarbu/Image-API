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
  ApiKeyDto,
  CreateApiKeyResult,
  RotateApiKeyResult,
} from "@/lib/services/api-keys";
import { revalidatePath } from "next/cache";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function createApiKeyAction(
  _prevState: ActionResult<CreateApiKeyResult> | null,
  formData: FormData
): Promise<ActionResult<CreateApiKeyResult>> {
  try {
    const context = await requireOrganizationContext();

    if (!canManageApiKeys(context.membership.role)) {
      return {
        success: false,
        error: "Forbidden: You do not have permission to create API keys in this organization.",
      };
    }

    const rawName = formData.get("name");
    const rawScopes = formData.get("scopes") || "image:transform";

    const parsed = createApiKeyInputSchema.safeParse({
      name: rawName,
      scopes: rawScopes,
    });

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid API key parameters.",
      };
    }

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
    return {
      success: false,
      error: (err as Error).message || "An unexpected error occurred while creating the API key.",
    };
  }
}

export async function revokeApiKeyAction(keyId: string): Promise<ActionResult<ApiKeyDto>> {
  try {
    const context = await requireOrganizationContext();

    if (!canManageApiKeys(context.membership.role)) {
      return {
        success: false,
        error: "Forbidden: You do not have permission to revoke API keys in this organization.",
      };
    }

    const parsedId = apiKeyIdSchema.safeParse(keyId);
    if (!parsedId.success) {
      return {
        success: false,
        error: "Invalid API key identifier.",
      };
    }

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
    return {
      success: false,
      error: (err as Error).message || "An unexpected error occurred while revoking the API key.",
    };
  }
}

export async function rotateApiKeyAction(
  keyId: string,
  mode: ApiKeyRotationMode
): Promise<ActionResult<RotateApiKeyResult>> {
  try {
    const context = await requireOrganizationContext();

    if (!canManageApiKeys(context.membership.role)) {
      return {
        success: false,
        error: "Forbidden: You do not have permission to rotate API keys in this organization.",
      };
    }

    const parsed = rotateApiKeyInputSchema.safeParse({ keyId, mode });
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid rotation parameters.",
      };
    }

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
    return {
      success: false,
      error: (err as Error).message || "An unexpected error occurred while rotating the API key.",
    };
  }
}
