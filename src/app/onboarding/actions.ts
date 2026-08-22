"use server";

import { createOrganizationSchema } from "@/lib/validations/organization";
import { getServerSessionUser } from "@/lib/tenant/context";
import { createOrganizationWithMembership, getUserFirstOrganization } from "@/lib/tenant/organizations";

export interface OnboardingActionResult {
  success?: boolean;
  error?: string;
  fieldErrors?: {
    name?: string[];
  };
}

export async function handleCreateOrganization(
  _prevState: OnboardingActionResult | null,
  formData: FormData
): Promise<OnboardingActionResult> {
  const user = await getServerSessionUser();
  if (!user) {
    return {
      error: "Authentication required. Please sign in to create an organization.",
    };
  }

  // Verify that the user doesn't already belong to an organization
  const existingOrg = await getUserFirstOrganization(user.id);
  if (existingOrg) {
    return {
      error: "You already belong to an organization.",
    };
  }

  const rawName = formData.get("name");
  const validation = createOrganizationSchema.safeParse({ name: rawName });

  if (!validation.success) {
    return {
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  try {
    await createOrganizationWithMembership(user.id, validation.data.name);
    return { success: true };
  } catch (error) {
    console.error("Failed to create organization:", error);
    return {
      error: "An unexpected error occurred while creating your organization. Please try again.",
    };
  }
}
