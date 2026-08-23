"use client";

import { useState, useTransition } from "react";
import { retryCustomerProvisioningAction } from "@/actions/billing";
import { RefreshCw, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function RetryProvisioningButton() {
  const [isPending, startTransition] = useTransition();
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const router = useRouter();

  const handleRetry = () => {
    setStatusMsg(null);
    startTransition(async () => {
      const res = await retryCustomerProvisioningAction();
      if (res.success) {
        setStatusMsg({ type: "success", text: "Customer provisioning completed successfully." });
        router.refresh();
      } else {
        setStatusMsg({ type: "error", text: res.error || "Retry failed." });
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={handleRetry}
        disabled={isPending}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
      >
        {isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Retrying...</span>
          </>
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry Customer Setup</span>
          </>
        )}
      </button>
      {statusMsg && (
        <p
          className={`text-xs ${
            statusMsg.type === "success"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {statusMsg.text}
        </p>
      )}
    </div>
  );
}
