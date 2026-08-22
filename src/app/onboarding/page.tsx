import Link from "next/link";
import { siteConfig } from "@/config/site";
import { requireNoOrganizationContext } from "@/lib/tenant/context";
import { OnboardingForm } from "@/components/onboarding-form";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { SignOutButton } from "@/components/sign-out-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // Requires user session and confirms no existing organization membership
  const user = await requireNoOrganizationContext();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 hover:opacity-80 transition-opacity"
          >
            {siteConfig.name}
          </Link>
          <SignOutButton />
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <div className="inline-flex items-center text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
              Step 1 of 1 • Workspace Setup
            </div>
            <CardTitle className="text-xl">Create your Organization</CardTitle>
            <CardDescription>
              Welcome, <span className="font-medium text-neutral-800 dark:text-neutral-200">{user.email}</span>. Please name your organization to get started.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
