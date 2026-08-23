"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { revokeApiKeyAction } from "@/actions/api-keys";
import { ApiKeyDto } from "@/lib/services/api-keys";

interface RevokeApiKeyDialogProps {
  apiKey: ApiKeyDto | null;
  onClose: () => void;
  onSuccess: (revokedKey: ApiKeyDto) => void;
}

export function RevokeApiKeyDialog({
  apiKey,
  onClose,
  onSuccess,
}: RevokeApiKeyDialogProps) {
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  if (!apiKey) return null;

  const handleRevoke = () => {
    setError(null);
    startTransition(async () => {
      const res = await revokeApiKeyAction(apiKey.id);
      if (!res.success || !res.data) {
        setError(res.error || "Failed to revoke API key.");
      } else {
        onSuccess(res.data);
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="revoke-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-red-200 dark:border-red-900/40 bg-white dark:bg-neutral-900 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
        <div className="space-y-1.5">
          <div className="flex items-center space-x-2 text-red-600 dark:text-red-400">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/60 font-bold text-sm">
              !
            </span>
            <h2 id="revoke-dialog-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Revoke API Key
            </h2>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            You are about to revoke <strong className="text-neutral-900 dark:text-neutral-100">{apiKey.name}</strong> ({apiKey.displayPrefix}).
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 p-3 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 p-3.5 text-xs text-red-800 dark:text-red-300 space-y-1">
          <p className="font-semibold">⚠️ Permanent Revocation</p>
          <p>
            Any backend services, background jobs, or applications using this key will <strong>immediately lose access</strong>. This operation cannot be undone.
          </p>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isPending}
          >
            Keep Key Active
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleRevoke}
            disabled={isPending}
          >
            {isPending ? "Revoking Key..." : "Yes, Revoke Key"}
          </Button>
        </div>
      </div>
    </div>
  );
}
