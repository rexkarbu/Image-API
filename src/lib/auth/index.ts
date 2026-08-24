import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { resolveApplicationOrigin } from "@/lib/security/origin";

function getBetterAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  const isDeployedVercel = Boolean(
    process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "development"
  );

  if (secret && secret.trim().length >= 32) {
    return secret.trim();
  }

  if (!isDeployedVercel) {
    return "development-and-build-placeholder-secret-min-32-chars-long";
  }

  throw new Error("Production Configuration Error: BETTER_AUTH_SECRET must be at least 32 characters.");
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  secret: getBetterAuthSecret(),
  baseURL: resolveApplicationOrigin(),
});
