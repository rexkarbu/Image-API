"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { rotateApiKeyAction } from "@/actions/api-keys";
import type { ApiKeyDto, RotateApiKeyResult } from "@/types/api-keys";
import { ApiKeyRotationMode } from "@/lib/validations/api-keys";

interface RotateApiKeyDialogProps {
  apiKey: ApiKeyDto | null;
  onClose: () => void;
  onSuccess: (result: RotateApiKeyResult) => void;
}

export function RotateApiKeyDialog({
  apiKey,
  onClose,
  onSuccess,
}: RotateApiKeyDialogProps) {
  const [mode, setMode] = React.useState<ApiKeyRotationMode>("grace_24h");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (apiKey) {
      confirmButtonRef.current?.focus();
    }
  }, [apiKey]);

  if (!apiKey) return null;

  const handleClose = () => {
    setError(null);
    setMode("grace_24h");
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !isPending) {
      handleClose();
    }
    // Trap focus
    if (e.key === "Tab" && dialogRef.current) {
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  };

  const handleRotate = () => {
    setError(null);
    startTransition(async () => {
      const res = await rotateApiKeyAction(apiKey.id, mode);
      if (!res.success || !res.data) {
        setError(res.error || "Failed to rotate API key.");
      } else {
        setError(null);
        onSuccess(res.data);
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotate-dialog-title"
      aria-describedby="rotate-dialog-desc"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95"
      >
        <div className="space-y-1">
          <h2 id="rotate-dialog-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Rotate Secret API Key
          </h2>
          <p id="rotate-dialog-desc" className="text-xs text-neutral-500 dark:text-neutral-400">
            Rotate key <strong className="text-neutral-900 dark:text-neutral-100">{apiKey.name}</strong> ({apiKey.displayPrefix}).
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 p-3 text-xs text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}

        <div className="space-y-3" role="radiogroup" aria-label="Select Transition Strategy">
          <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
            Select Transition Strategy
          </label>

          <label
            htmlFor="mode-grace"
            className={`flex flex-col cursor-pointer rounded-lg border p-3 text-xs transition-colors space-y-1 ${
              mode === "grace_24h"
                ? "border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800/60"
                : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                24-Hour Grace Period (Recommended)
              </span>
              <input
                id="mode-grace"
                type="radio"
                name="rotation-mode"
                value="grace_24h"
                checked={mode === "grace_24h"}
                onChange={() => setMode("grace_24h")}
                disabled={isPending}
                className="text-neutral-900 focus:ring-neutral-500"
              />
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              The existing key remains active for 24 hours, allowing you to update your application services without downtime.
            </p>
          </label>

          <label
            htmlFor="mode-immediate"
            className={`flex flex-col cursor-pointer rounded-lg border p-3 text-xs transition-colors space-y-1 ${
              mode === "immediate"
                ? "border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800/60"
                : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                Immediate Invalidation
              </span>
              <input
                id="mode-immediate"
                type="radio"
                name="rotation-mode"
                value="immediate"
                checked={mode === "immediate"}
                onChange={() => setMode("immediate")}
                disabled={isPending}
                className="text-neutral-900 focus:ring-neutral-500"
              />
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Immediately revokes the current key. Use this if the current key has been compromised or leaked.
            </p>
          </label>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant="default"
            size="sm"
            onClick={handleRotate}
            disabled={isPending}
          >
            {isPending ? "Rotating Key..." : "Confirm & Rotate Key"}
          </Button>
        </div>
      </div>
    </div>
  );
}
