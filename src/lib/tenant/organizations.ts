import { eq } from "drizzle-orm";
import { db, DbClient } from "@/db";
import { organizations, organizationMembers, Organization, OrganizationMember } from "@/db/schema";
import { createOrganizationSchema } from "@/lib/validations/organization";
import { assertOrganizationScope } from "./rules";

export interface UserOrganizationContext {
  organization: Organization;
  membership: OrganizationMember;
}

/**
 * Finds the primary/first organization membership for a given user ID.
 *
 * Used for onboarding checks and initial organization context resolution.
 */
export async function getUserFirstOrganization(
  userId: string,
  client: DbClient = db
): Promise<UserOrganizationContext | null> {
  if (!userId || typeof userId !== "string") {
    return null;
  }

  const results = await client
    .select({
      organization: organizations,
      membership: organizationMembers,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  return results[0];
}

/**
 * Atomically creates a new organization and assigns the current user as the 'owner'.
 *
 * Executed within a single database transaction to guarantee consistency.
 */
export async function createOrganizationWithMembership(
  userId: string,
  rawName: string,
  client: DbClient = db
): Promise<UserOrganizationContext> {
  if (!userId || typeof userId !== "string") {
    throw new Error("Cannot create organization: valid userId is required.");
  }

  const { name } = createOrganizationSchema.parse({ name: rawName });

  return await client.transaction(async (tx) => {
    const orgId = crypto.randomUUID();
    const now = new Date();

    const [newOrg] = await tx
      .insert(organizations)
      .values({
        id: orgId,
        name,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [newMembership] = await tx
      .insert(organizationMembers)
      .values({
        organizationId: orgId,
        userId,
        role: "owner",
        createdAt: now,
      })
      .returning();

    return {
      organization: newOrg,
      membership: newMembership,
    };
  });
}

/**
 * Tenant-scoped query helper to fetch an organization by ID.
 * Enforces organizationId assertion to maintain multi-tenancy invariants.
 */
export async function getOrganizationById(
  organizationId: string,
  client: DbClient = db
): Promise<Organization | null> {
  const safeOrgId = assertOrganizationScope(organizationId);

  const [org] = await client
    .select()
    .from(organizations)
    .where(eq(organizations.id, safeOrgId))
    .limit(1);

  return org ?? null;
}
