import { describe, it, expect } from "vitest";
import {
  evaluateDashboardAccess,
  evaluateOnboardingAccess,
  evaluateAuthPageAccess,
  isValidOrganizationRole,
  assertOrganizationScope,
  validateTenantScopedParams,
} from "@/lib/tenant/rules";

describe("Tenant & Auth Routing Decision Logic", () => {
  describe("evaluateDashboardAccess", () => {
    it("should redirect to /sign-in if user is not authenticated", () => {
      expect(
        evaluateDashboardAccess({
          isAuthenticated: false,
          hasOrganization: false,
        })
      ).toBe("redirect_to_signin");

      expect(
        evaluateDashboardAccess({
          isAuthenticated: false,
          hasOrganization: true,
        })
      ).toBe("redirect_to_signin");
    });

    it("should redirect to /onboarding if user is authenticated but has no organization", () => {
      expect(
        evaluateDashboardAccess({
          isAuthenticated: true,
          hasOrganization: false,
        })
      ).toBe("redirect_to_onboarding");
    });

    it("should allow access when user is authenticated and belongs to an organization", () => {
      expect(
        evaluateDashboardAccess({
          isAuthenticated: true,
          hasOrganization: true,
        })
      ).toBe("allow");
    });
  });

  describe("evaluateOnboardingAccess", () => {
    it("should redirect unauthenticated users to /sign-in", () => {
      expect(
        evaluateOnboardingAccess({
          isAuthenticated: false,
          hasOrganization: false,
        })
      ).toBe("redirect_to_signin");
    });

    it("should allow access when user is authenticated and has no organization", () => {
      expect(
        evaluateOnboardingAccess({
          isAuthenticated: true,
          hasOrganization: false,
        })
      ).toBe("allow");
    });

    it("should redirect to /dashboard if user already belongs to an organization", () => {
      expect(
        evaluateOnboardingAccess({
          isAuthenticated: true,
          hasOrganization: true,
        })
      ).toBe("redirect_to_dashboard");
    });
  });

  describe("evaluateAuthPageAccess", () => {
    it("should allow unauthenticated visitors to view sign-in and sign-up pages", () => {
      expect(
        evaluateAuthPageAccess({
          isAuthenticated: false,
          hasOrganization: false,
        })
      ).toBe("allow");
    });

    it("should redirect authenticated users without an organization to /onboarding", () => {
      expect(
        evaluateAuthPageAccess({
          isAuthenticated: true,
          hasOrganization: false,
        })
      ).toBe("redirect_to_onboarding");
    });

    it("should redirect authenticated users with an organization to /dashboard", () => {
      expect(
        evaluateAuthPageAccess({
          isAuthenticated: true,
          hasOrganization: true,
        })
      ).toBe("redirect_to_dashboard");
    });
  });

  describe("isValidOrganizationRole", () => {
    it("should return true for valid organization roles", () => {
      expect(isValidOrganizationRole("owner")).toBe(true);
      expect(isValidOrganizationRole("admin")).toBe(true);
      expect(isValidOrganizationRole("member")).toBe(true);
    });

    it("should return false for invalid organization roles", () => {
      expect(isValidOrganizationRole("superadmin")).toBe(false);
      expect(isValidOrganizationRole("guest")).toBe(false);
      expect(isValidOrganizationRole("")).toBe(false);
    });
  });

  describe("Tenant Security Invariant Checks", () => {
    it("assertOrganizationScope should throw when organizationId is missing or empty", () => {
      expect(() => assertOrganizationScope(null)).toThrow(
        "TENANT SECURITY INVARIANT VIOLATION"
      );
      expect(() => assertOrganizationScope(undefined)).toThrow(
        "TENANT SECURITY INVARIANT VIOLATION"
      );
      expect(() => assertOrganizationScope("")).toThrow(
        "TENANT SECURITY INVARIANT VIOLATION"
      );
      expect(() => assertOrganizationScope("   ")).toThrow(
        "TENANT SECURITY INVARIANT VIOLATION"
      );
    });

    it("assertOrganizationScope should return sanitized organizationId when valid", () => {
      expect(assertOrganizationScope("org_123456")).toBe("org_123456");
      expect(assertOrganizationScope("  org_123456  ")).toBe("org_123456");
    });

    it("validateTenantScopedParams should validate object parameters", () => {
      const validParams = {
        organizationId: "org_abc",
        filter: "active",
      };
      expect(validateTenantScopedParams(validParams)).toEqual(validParams);

      const invalidParams = {
        organizationId: "",
        filter: "active",
      };
      expect(() => validateTenantScopedParams(invalidParams)).toThrow(
        "TENANT SECURITY INVARIANT VIOLATION"
      );
    });
  });
});
