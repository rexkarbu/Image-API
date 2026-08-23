import Link from "next/link";
import { siteConfig } from "@/config/site";
import { requireOrganizationContext } from "@/lib/tenant/context";
import { SignOutButton } from "@/components/sign-out-button";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side authentication and organization context check
  const tenantContext = await requireOrganizationContext();

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      {/* Dashboard Top Navigation */}
      <header className="sticky top-0 z-40 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <Link
              href="/dashboard"
              className="font-bold text-base tracking-tight text-neutral-900 dark:text-neutral-100 flex items-center space-x-2"
            >
              <span>{siteConfig.name}</span>
            </Link>

            <DashboardNav />

            <div className="hidden sm:flex items-center space-x-2 text-xs font-mono">
              <span className="text-neutral-400 dark:text-neutral-600">/</span>
              <span className="font-medium text-neutral-700 dark:text-neutral-300 px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800">
                {tenantContext.organization.name}
              </span>
              <span className="text-neutral-500 capitalize">
                ({tenantContext.membership.role})
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                {tenantContext.user.name || tenantContext.user.email}
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {tenantContext.user.email}
              </div>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 dark:border-neutral-800 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400 bg-white dark:bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4">
          {siteConfig.name} • Organization ID:{" "}
          <span className="font-mono text-neutral-600 dark:text-neutral-400">
            {tenantContext.organization.id}
          </span>
        </div>
      </footer>
    </div>
  );
}
