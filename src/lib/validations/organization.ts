import { z } from "zod";

export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const organizationRoleSchema = z.enum(ORGANIZATION_ROLES);

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2, "Organization name must be at least 2 characters")
  .max(64, "Organization name must not exceed 64 characters")
  .regex(
    /^[a-zA-Z0-9\s-_.]+$/,
    "Organization name can only contain letters, numbers, spaces, hyphens, underscores, and periods"
  );

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
