"use client";

import { useState, useTransition } from "react";
import { createPortalSessionAction } from "@/actions/billing";
import { ExternalLink, Loader2 } from "lucide-react";

export function PortalButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handlePortal = () => {
    setError(null);
    startTransition(async () => {
      try {
        await createPortalSessionAction();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={handlePortal}
        disabled={isPending}
        className="inline-flex items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Opening Portal...</span>
          </>
        ) : (
          <>
            <ExternalLink className="h-4 w-4" />
            <span>Manage in Customer Portal</span>
          </>
        )}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
