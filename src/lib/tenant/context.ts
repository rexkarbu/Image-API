import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserFirstOrganization } from "./organizations";
import { Organization, OrganizationMember } from "@/db/schema";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrustedTenantContext {
  user: AuthenticatedUser;
  organization: Organization;
  membership: OrganizationMember;
}

/**
 * Retrieves the current session user from the server-side Better Auth session.
 */
export async function getServerSessionUser(): Promise<AuthenticatedUser | null> {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({
    headers: reqHeaders,
  });

  if (!session?.user) {
    return null;
  }

  return session.user as AuthenticatedUser;
}

/**
 * Server-only helper: Requires an authenticated user session.
 * If unauthenticated, immediately redirects to /sign-in.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/sign-in");
  }
  return user;
}

/**
 * Server-only helper: Returns the trusted organization context if authenticated and member of an org.
 */
export async function getCurrentOrganization(): Promise<TrustedTenantContext | null> {
  const user = await getServerSessionUser();
  if (!user) {
    return null;
  }

  const orgContext = await getUserFirstOrganization(user.id);
  if (!orgContext) {
    return null;
  }

  return {
    user,
    organization: orgContext.organization,
    membership: orgContext.membership,
  };
}

/**
 * Server-only helper: Requires an authenticated user and an established organization context.
 *
 * 1. If unauthenticated -> redirects to /sign-in.
 * 2. If authenticated but has no organization -> redirects to /onboarding.
 * 3. If valid -> returns trusted { user, organization, membership }.
 */
export async function requireOrganizationContext(): Promise<TrustedTenantContext> {
  const user = await requireUser();
  const orgContext = await getUserFirstOrganization(user.id);

  if (!orgContext) {
    redirect("/onboarding");
  }

  return {
    user,
    organization: orgContext.organization,
    membership: orgContext.membership,
  };
}

/**
 * Server-only helper for /onboarding page:
 * Requires an authenticated user who does NOT already belong to an organization.
 * If the user already belongs to an organization, redirects to /dashboard.
 */
export async function requireNoOrganizationContext(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  const orgContext = await getUserFirstOrganization(user.id);

  if (orgContext) {
    redirect("/dashboard");
  }

  return user;
}
