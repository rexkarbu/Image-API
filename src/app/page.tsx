import Link from "next/link";
import { siteConfig } from "@/config/site";
import { getCurrentOrganization } from "@/lib/tenant/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tenantContext = await getCurrentOrganization().catch(() => null);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="font-semibold text-base tracking-tight text-neutral-900 dark:text-neutral-100">
              {siteConfig.name}
            </span>
            <span className="inline-flex items-center rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Foundation MVP
            </span>
          </div>

          <nav className="flex items-center space-x-3">
            {tenantContext ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-md bg-neutral-900 dark:bg-neutral-50 px-4 py-2 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-md bg-neutral-900 dark:bg-neutral-50 px-4 py-2 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                  Get Started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-2xl">
          <div className="inline-flex items-center rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-2.5 py-1 text-xs font-mono text-neutral-600 dark:text-neutral-400 mb-6">
            Developer Platform • Early Access
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            High-performance usage-based image processing for developers
          </h1>

          <p className="mt-4 text-base text-neutral-600 dark:text-neutral-400 leading-relaxed">
            {siteConfig.name} provides secure, organization-isolated API keys and predictable
            usage-based billing for image resize, conversion, and compression pipelines.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            {tenantContext ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-md bg-neutral-900 dark:bg-neutral-50 px-5 py-2.5 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                Open Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-md bg-neutral-900 dark:bg-neutral-50 px-5 py-2.5 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                  Create Developer Account
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-5 py-2.5 text-sm font-medium text-neutral-900 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                >
                  Sign In
                </Link>
              </>
            )}
          </div>

          {/* Technical Specs Foundation Note */}
          <div className="mt-16 pt-8 border-t border-neutral-200 dark:border-neutral-800">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-4">
              Architecture & Security Invariants
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono text-neutral-600 dark:text-neutral-400">
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
                <span className="font-semibold text-neutral-800 dark:text-neutral-200 block mb-1">Multi-Tenancy</span>
                Organization-scoped data access with cryptographic API key hashing.
              </div>
              <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
                <span className="font-semibold text-neutral-800 dark:text-neutral-200 block mb-1">Metering Model</span>
                Immutable event stream for reliable usage reconciliation.
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 dark:border-neutral-800 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
        <div className="max-w-6xl mx-auto px-4">
          {siteConfig.name} • Foundation Milestone
        </div>
      </footer>
    </div>
  );
}
