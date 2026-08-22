import { redirect } from "next/navigation";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { getCurrentOrganization, getServerSessionUser } from "@/lib/tenant/context";
import { SignInForm } from "@/components/sign-in-form";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const user = await getServerSessionUser().catch(() => null);

  if (user) {
    const orgContext = await getCurrentOrganization().catch(() => null);
    if (orgContext) {
      redirect("/dashboard");
    } else {
      redirect("/onboarding");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 hover:opacity-80 transition-opacity"
          >
            {siteConfig.name}
          </Link>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Sign in to access your developer console
          </p>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>
              Enter your email and password to access your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignInForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
