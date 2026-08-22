import { requireOrganizationContext } from "@/lib/tenant/context";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { siteConfig } from "@/config/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, organization, membership } = await requireOrganizationContext();

  return (
    <div className="space-y-8">
      {/* Workspace Overview Header */}
      <div>
        <div className="flex items-center space-x-2 text-xs font-mono text-neutral-500 mb-1">
          <span>WORKSPACE</span>
          <span>•</span>
          <span>FOUNDATION M0</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          {organization.name}
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          Manage API keys, monitor image transformation usage, and configure developer credentials.
        </p>
      </div>

      {/* Account & Tenant Metadata */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-1">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Active Workspace
          </div>
          <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {organization.name}
          </div>
          <div className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500 truncate">
            ID: {organization.id}
          </div>
        </div>

        <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-1">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Developer Account
          </div>
          <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {user.email}
          </div>
          <div className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500 truncate">
            User ID: {user.id}
          </div>
        </div>

        <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-1">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Role & Permissions
          </div>
          <div className="text-sm font-semibold capitalize text-neutral-900 dark:text-neutral-100">
            {membership.role}
          </div>
          <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Full workspace administration
          </div>
        </div>
      </div>

      {/* Real Empty Foundation States */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* API Keys Foundation State */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">API Keys</CardTitle>
              <span className="inline-flex items-center rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-mono text-neutral-600 dark:text-neutral-400">
                Milestone 1
              </span>
            </div>
            <CardDescription>
              Cryptographically hashed keys used to authenticate requests to {siteConfig.name}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-800 p-8 text-center space-y-2">
              <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                No active API keys yet
              </p>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 max-w-sm mx-auto">
                Secure API key creation, prefix indexing, and one-time secret revelation will be enabled in Milestone 1.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Usage & Metering Foundation State */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Usage & Metering</CardTitle>
              <span className="inline-flex items-center rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-mono text-neutral-600 dark:text-neutral-400">
                Milestone 2
              </span>
            </div>
            <CardDescription>
              Immutable request-level audit log recording successful transformation units.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-800 p-8 text-center space-y-2">
              <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                No recorded usage events
              </p>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 max-w-sm mx-auto">
                Image processing endpoint <code className="bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded text-[11px]">POST /v1/images/transform</code> and usage recording will be connected in Milestone 2.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
