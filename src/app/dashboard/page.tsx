import Link from "next/link";
import { requireOrganizationContext } from "@/lib/tenant/context";
import { listApiKeys } from "@/lib/services/api-keys";
import { getOverviewStats } from "@/lib/services/usage-analytics";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { Activity, Key, Layers, ArrowUpRight } from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatUtcTimestamp(isoString: string | null): string {
  if (!isoString) return "No recorded activity";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "No recorded activity";
    return d.toUTCString().replace("GMT", "UTC");
  } catch {
    return "No recorded activity";
  }
}

export default async function DashboardPage() {
  const { user, organization, membership } = await requireOrganizationContext();

  const [allKeys, overviewStats] = await Promise.all([
    listApiKeys({ organizationId: organization.id }),
    getOverviewStats(organization.id),
  ]);

  const activeKeysCount = allKeys.filter((k) => k.status === "active").length;

  return (
    <div className="space-y-8">
      {/* Workspace Overview Header */}
      <div>
        <div className="flex items-center space-x-2 text-xs font-mono text-neutral-500 mb-1">
          <span>{organization.name.toUpperCase()}</span>
          <span>•</span>
          <span>WORKSPACE OVERVIEW</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          Developer Dashboard
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          Manage API credentials, inspect real transformation metrics, and monitor usage consumption.
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

      {/* Live System Summaries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Usage & Metering Live Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Layers className="h-4 w-4 text-neutral-500" />
                <CardTitle className="text-base font-semibold">Usage & Metering</CardTitle>
              </div>
              <Link
                href="/dashboard/usage"
                className="text-xs font-medium text-neutral-900 dark:text-neutral-100 hover:underline flex items-center space-x-0.5"
              >
                <span>Analytics</span>
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            <CardDescription>
              Real-time consumption recorded by <code className="font-mono">POST /v1/images/transform</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overviewStats.currentMonthUnits > 0 ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-xs text-neutral-500">Month-to-Date Volume</div>
                    <div className="text-xl font-bold font-mono text-neutral-900 dark:text-neutral-100">
                      {overviewStats.currentMonthUnits.toLocaleString()} units
                    </div>
                  </div>
                  <Link href="/dashboard/usage">
                    <Button variant="outline" size="sm" className="text-xs h-8">
                      View Usage Breakdown
                    </Button>
                  </Link>
                </div>
                <div className="text-[11px] text-neutral-500 flex items-center justify-between">
                  <span>Quota: No quota configured</span>
                  <span>Latest: {formatUtcTimestamp(overviewStats.latestEventAt)}</span>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-800 p-6 text-center space-y-3">
                <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                  0 units recorded this month
                </p>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 max-w-sm mx-auto">
                  Transform images via <code className="bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded text-[11px]">POST /v1/images/transform</code> to monitor real-time consumption.
                </p>
                <Link href="/dashboard/usage">
                  <Button variant="outline" size="sm" className="text-xs">
                    Open Usage Dashboard
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* API Keys Live Summary Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Key className="h-4 w-4 text-neutral-500" />
                <CardTitle className="text-base font-semibold">API Keys</CardTitle>
              </div>
              <Link
                href="/dashboard/api-keys"
                className="text-xs font-medium text-neutral-900 dark:text-neutral-100 hover:underline flex items-center space-x-0.5"
              >
                <span>Manage keys</span>
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            <CardDescription>
              Cryptographically hashed secret keys authenticating requests to {siteConfig.name}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeKeysCount > 0 ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-xs text-neutral-500">Active Keys</div>
                    <div className="text-xl font-bold font-mono text-neutral-900 dark:text-neutral-100">
                      {activeKeysCount} {activeKeysCount === 1 ? "key" : "keys"}
                    </div>
                  </div>
                  <Link href="/dashboard/api-keys">
                    <Button variant="outline" size="sm" className="text-xs h-8">
                      Manage Keys ({allKeys.length})
                    </Button>
                  </Link>
                </div>
                <div className="text-[11px] text-neutral-500">
                  Scoped exclusively for <code className="font-mono">image:transform</code>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-800 p-6 text-center space-y-3">
                <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                  No active API keys yet
                </p>
                <Link href="/dashboard/api-keys">
                  <Button variant="outline" size="sm" className="text-xs">
                    Create API Key
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
