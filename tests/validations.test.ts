import { describe, it, expect } from "vitest";
import {
  organizationNameSchema,
  createOrganizationSchema,
  organizationRoleSchema,
  ORGANIZATION_ROLES,
} from "@/lib/validations/organization";
import { signUpSchema, signInSchema } from "@/lib/validations/auth";

describe("Organization Validation Schemas", () => {
  describe("organizationNameSchema", () => {
    it("should accept valid organization names", () => {
      const validNames = [
        "Acme Corp",
        "Pixel-Studio",
        "Image_Lab.v2",
        "Dev 123",
        "A-B_C.D",
      ];
      for (const name of validNames) {
        const result = organizationNameSchema.safeParse(name);
        expect(result.success).toBe(true);
      }
    });

    it("should trim surrounding whitespace", () => {
      const result = organizationNameSchema.safeParse("  Acme Corp  ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("Acme Corp");
      }
    });

    it("should reject names shorter than 2 characters", () => {
      const invalid = ["", "a", "   "];
      for (const name of invalid) {
        const result = organizationNameSchema.safeParse(name);
        expect(result.success).toBe(false);
      }
    });

    it("should reject names longer than 64 characters", () => {
      const tooLong = "a".repeat(65);
      const result = organizationNameSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });

    it("should reject invalid characters such as script tags or SQL injection attempts", () => {
      const dangerous = [
        "<script>alert(1)</script>",
        "Org; DROP TABLE organizations;",
        "Org & Co.",
        "Org / Team",
        "Org * Star",
      ];
      for (const name of dangerous) {
        const result = organizationNameSchema.safeParse(name);
        expect(result.success).toBe(false);
      }
    });
  });

  describe("organizationRoleSchema", () => {
    it("should accept only defined organization roles", () => {
      expect(ORGANIZATION_ROLES).toEqual(["owner", "admin", "member"]);

      for (const role of ORGANIZATION_ROLES) {
        const result = organizationRoleSchema.safeParse(role);
        expect(result.success).toBe(true);
      }
    });

    it("should reject unauthorized or arbitrary role names", () => {
      const invalidRoles = ["superadmin", "guest", "billing_admin", "root", ""];
      for (const role of invalidRoles) {
        const result = organizationRoleSchema.safeParse(role);
        expect(result.success).toBe(false);
      }
    });
  });

  describe("createOrganizationSchema", () => {
    it("should validate full object payload", () => {
      const valid = createOrganizationSchema.safeParse({ name: "Modern Media Inc" });
      expect(valid.success).toBe(true);
    });

    it("should fail when name field is missing", () => {
      const invalid = createOrganizationSchema.safeParse({});
      expect(invalid.success).toBe(false);
    });
  });
});

describe("Authentication Validation Schemas", () => {
  describe("signUpSchema", () => {
    it("should accept valid sign-up details", () => {
      const result = signUpSchema.safeParse({
        name: "Jane Developer",
        email: "jane@example.com",
        password: "securePassword123!",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid email addresses", () => {
      const invalidEmails = ["not-an-email", "user@", "@domain.com", "user@domain"];
      for (const email of invalidEmails) {
        const result = signUpSchema.safeParse({
          name: "Jane Developer",
          email,
          password: "securePassword123!",
        });
        expect(result.success).toBe(false);
      }
    });

    it("should reject passwords shorter than 8 characters", () => {
      const result = signUpSchema.safeParse({
        name: "Jane Developer",
        email: "jane@example.com",
        password: "short",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty names", () => {
      const result = signUpSchema.safeParse({
        name: " ",
        email: "jane@example.com",
        password: "securePassword123!",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("signInSchema", () => {
    it("should accept valid credentials", () => {
      const result = signInSchema.safeParse({
        email: "developer@example.com",
        password: "anyPasswordValue",
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing email or password", () => {
      expect(signInSchema.safeParse({ email: "", password: "pass" }).success).toBe(false);
      expect(signInSchema.safeParse({ email: "dev@example.com", password: "" }).success).toBe(false);
    });
  });
});
