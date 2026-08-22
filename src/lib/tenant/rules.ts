import { ORGANIZATION_ROLES, OrganizationRole } from "@/lib/validations/organization";

export type AuthState = {
  isAuthenticated: boolean;
  hasOrganization: boolean;
};

export type RouteDecision =
  | "allow"
  | "redirect_to_signin"
  | "redirect_to_onboarding"
  | "redirect_to_dashboard";

/**
 * Route access decision logic for /dashboard.
 * Enforces server-side protection requiring both authentication and organization membership.
 */
export function evaluateDashboardAccess(state: AuthState): RouteDecision {
  if (!state.isAuthenticated) {
    return "redirect_to_signin";
  }
  if (!state.hasOrganization) {
    return "redirect_to_onboarding";
  }
  return "allow";
}

/**
 * Route access decision logic for /onboarding.
 * Users must be authenticated, but must not already belong to an organization.
 */
export function evaluateOnboardingAccess(state: AuthState): RouteDecision {
  if (!state.isAuthenticated) {
    return "redirect_to_signin";
  }
  if (state.hasOrganization) {
    return "redirect_to_dashboard";
  }
  return "allow";
}

/**
 * Route access decision logic for /sign-in and /sign-up.
 * Authenticated users are redirected away from auth pages to their appropriate next step.
 */
export function evaluateAuthPageAccess(state: AuthState): RouteDecision {
  if (!state.isAuthenticated) {
    return "allow";
  }
  if (!state.hasOrganization) {
    return "redirect_to_onboarding";
  }
  return "redirect_to_dashboard";
}

/**
 * Validates that an organization role string is a recognized valid role.
 */
export function isValidOrganizationRole(role: string): role is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(role);
}

/**
 * Hard Multi-Tenancy Invariant Helper:
 * Ensures every organization-owned query or mutation explicitly provides a valid organization ID.
 */
export function assertOrganizationScope(organizationId: string | null | undefined): string {
  if (!organizationId || typeof organizationId !== "string" || organizationId.trim().length === 0) {
    throw new Error(
      "TENANT SECURITY INVARIANT VIOLATION: An organizationId is strictly required for this operation."
    );
  }
  return organizationId.trim();
}

/**
 * Verifies that a tenant-scoped query parameter object contains a non-empty organizationId.
 */
export function validateTenantScopedParams<T extends { organizationId: string }>(params: T): T {
  assertOrganizationScope(params.organizationId);
  return params;
}
