import { requireOrganizationContext } from "@/lib/tenant/context";
import { getBillingDashboardData } from "@/lib/services/billing-dashboard";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { PortalButton } from "@/components/billing/portal-button";
import { RetryProvisioningButton } from "@/components/billing/retry-provisioning-button";
import { ReconcileButton } from "@/components/billing/reconcile-button";
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  HelpCircle,
  Activity,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default async function BillingPage() {
  const tenantContext = await requireOrganizationContext();
  const data = await getBillingDashboardData(
    tenantContext.organization.id,
    tenantContext.user.id
  );

  const isSubscribed =
    data.subscription &&
    !["canceled", "incomplete_expired"].includes(data.subscription.status);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              Billing & Subscriptions
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Test Mode (Sandbox)
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Manage your organization&apos;s metered billing subscription, usage reporting, and invoice history.
          </p>
        </div>

        {/* Read-Only Notice for Non-Owners */}
        {!data.isOwner && (
          <div className="rounded-md bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700">
            <span className="font-semibold">View-Only:</span> Billing modifications require organization Owner role.
          </div>
        )}
      </div>

      {/* Customer Setup Notice if Pending/Failed */}
      {data.customer && data.customer.provisioningStatus !== "ready" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Stripe Customer Profile Setup {data.customer.provisioningStatus === "pending" ? "Pending" : "Failed"}
              </h2>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {data.customer.provisioningStatus === "pending"
                  ? "Stripe Customer profile provisioning is queued for background completion."
                  : `Stripe Customer provisioning encountered a temporary error: ${data.customer.lastErrorCode || "unknown"}.`}
              </p>
              {data.isOwner && (
                <div className="pt-2">
                  <RetryProvisioningButton />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Grid: Subscription Status & Usage Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Subscription Status Card */}
        <div className="lg:col-span-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />
                <h2 className="font-semibold text-base text-neutral-900 dark:text-neutral-100">
                  Subscription Plan
                </h2>
              </div>
              {isSubscribed ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="capitalize">{data.subscription?.status}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  No Active Subscription
                </span>
              )}
            </div>

            <div className="py-5 space-y-4">
              {isSubscribed && data.subscription ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">Billing Period</span>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100 font-mono text-xs mt-0.5">
                      {formatDate(data.subscription.currentPeriodStart)} – {formatDate(data.subscription.currentPeriodEnd)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">Metering Enabled</span>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100 font-mono text-xs mt-0.5">
                      {formatDate(data.subscription.meteringEnabledAt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">Auto-Renewal</span>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100 mt-0.5">
                      {data.subscription.cancelAtPeriodEnd ? "Cancels at period end" : "Active auto-renew"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">Stripe Subscription ID</span>
                    <p className="font-mono text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 truncate max-w-[200px]">
                      {data.subscription.stripeSubscriptionId}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">
                    Subscribe to the metered transformation plan to report production usage and receive invoices.
                  </p>
                  <ul className="text-xs text-neutral-500 dark:text-neutral-400 space-y-1 list-disc pl-4">
                    <li>Pay only for executed image transformations.</li>
                    <li>Automated batching and Stripe Billing Meter reporting.</li>
                    <li>Hosted Stripe Checkout and Customer Portal management.</li>
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 flex items-center gap-3">
            {data.isOwner ? (
              isSubscribed ? (
                <PortalButton />
              ) : (
                <CheckoutButton />
              )
            ) : (
              <p className="text-xs text-neutral-500">Contact your organization owner to manage billing subscriptions.</p>
            )}
          </div>
        </div>

        {/* Usage Summary Card */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />
                <h2 className="font-semibold text-base text-neutral-900 dark:text-neutral-100">
                  Current Usage
                </h2>
              </div>
              <span className="text-xs text-neutral-500 font-mono">Current Period</span>
            </div>

            <div className="py-5 space-y-4">
              <div>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">Total Local Units</span>
                <p className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 font-mono mt-1">
                  {data.usage.currentPeriodLocalUnits.toLocaleString()}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-neutral-100 dark:border-neutral-800 text-xs">
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Reported</span>
                  <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {data.usage.reportedUnits.toLocaleString()} units
                  </p>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Pending</span>
                  <p className="font-mono font-semibold text-neutral-700 dark:text-neutral-300 mt-0.5">
                    {data.usage.pendingUnits.toLocaleString()} units
                  </p>
                </div>
              </div>

              {data.usage.manualReviewUnits > 0 && (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
                  <span className="font-semibold">Manual Review:</span> {data.usage.manualReviewUnits} units flagged for audit.
                </div>
              )}
            </div>
          </div>

          {/* Reconciliation status footer */}
          <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs">
            <span className="text-neutral-500">Reconciliation:</span>
            <span
              className={clsx(
                "font-medium capitalize",
                data.usage.lastReconciliationStatus === "matched" && "text-emerald-600 dark:text-emerald-400",
                data.usage.lastReconciliationStatus === "pending_provider" && "text-amber-600 dark:text-amber-400",
                data.usage.lastReconciliationStatus === "mismatch" && "text-red-600 dark:text-red-400",
                !data.usage.lastReconciliationStatus && "text-neutral-400"
              )}
            >
              {data.usage.lastReconciliationStatus || "Not run yet"}
            </span>
          </div>
        </div>
      </div>

      {/* Provider Reconciliation Bar */}
      {isSubscribed && data.isOwner && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Provider Usage Reconciliation
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Verify reported usage against Stripe Meter Event Summaries for the current period.
            </p>
          </div>
          <ReconcileButton />
        </div>
      )}

      {/* Recent Invoices Section */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />
            <h2 className="font-semibold text-base text-neutral-900 dark:text-neutral-100">
              Invoices & Statements
            </h2>
          </div>
          <span className="text-xs text-neutral-500">Authoritative Stripe records</span>
        </div>

        {data.invoices.length === 0 ? (
          <div className="p-12 text-center">
            <Clock className="h-8 w-8 text-neutral-400 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              No invoices yet
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm mx-auto">
              Invoices generated by Stripe Billing at the end of each billing period will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 dark:bg-neutral-800/60 border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 font-medium">
                <tr>
                  <th className="px-6 py-3">Invoice ID</th>
                  <th className="px-6 py-3">Period</th>
                  <th className="px-6 py-3">Amount Due</th>
                  <th className="px-6 py-3">Amount Paid</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {data.invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                    <td className="px-6 py-3.5 font-mono text-neutral-700 dark:text-neutral-300">
                      {inv.stripeInvoiceId}
                    </td>
                    <td className="px-6 py-3.5 text-neutral-600 dark:text-neutral-400 font-mono">
                      {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                    </td>
                    <td className="px-6 py-3.5 font-mono font-medium text-neutral-900 dark:text-neutral-100">
                      {formatCurrency(inv.amountDue, inv.currency)}
                    </td>
                    <td className="px-6 py-3.5 font-mono text-neutral-600 dark:text-neutral-400">
                      {formatCurrency(inv.amountPaid, inv.currency)}
                    </td>
                    <td className="px-6 py-3.5">
                      <span
                        className={clsx(
                          "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold capitalize",
                          inv.status === "paid" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                          inv.status === "open" && "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
                          inv.status === "draft" && "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
                          (inv.status === "uncollectible" || inv.status === "void") &&
                            "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                        )}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right space-x-2">
                      {inv.hostedInvoiceUrl && (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
                        >
                          View
                        </a>
                      )}
                      {inv.invoicePdfUrl && (
                        <a
                          href={inv.invoicePdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                        >
                          PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
