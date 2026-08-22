import { redirect } from "next/navigation";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { getCurrentOrganization, getServerSessionUser } from "@/lib/tenant/context";
import { SignUpForm } from "@/components/sign-up-form";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
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
            Create an account to start building
          </p>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Create account</CardTitle>
            <CardDescription>
              Enter your details to register as a developer
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignUpForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
