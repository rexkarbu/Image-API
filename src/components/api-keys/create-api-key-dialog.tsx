"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createApiKeyAction } from "@/actions/api-keys";
import { CreateApiKeyResult } from "@/lib/services/api-keys";

interface CreateApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: CreateApiKeyResult) => void;
}

export function CreateApiKeyDialog({
  isOpen,
  onClose,
  onSuccess,
}: CreateApiKeyDialogProps) {
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("API key name must be at least 2 characters long.");
      return;
    }
    if (trimmedName.length > 64) {
      setError("API key name must be at most 64 characters long.");
      return;
    }

    const formData = new FormData();
    formData.set("name", trimmedName);
    formData.set("scopes", "image:transform");

    startTransition(async () => {
      const res = await createApiKeyAction(null, formData);
      if (!res.success || !res.data) {
        setError(res.error || "Failed to create API key.");
      } else {
        setName("");
        onSuccess(res.data);
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
        <div className="space-y-1">
          <h2 id="create-dialog-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Create Secret API Key
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Generate a new scoped secret key for programmatic image processing requests.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 p-3 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="key-name" className="text-xs font-medium">
              Key Name / Description
            </Label>
            <Input
              id="key-name"
              type="text"
              placeholder="e.g. Production Web Backend, Staging Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
              required
              minLength={2}
              maxLength={64}
              className="text-sm"
              autoFocus
            />
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Between 2 and 64 characters. Used to identify the key in your dashboard.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Assigned Scopes</Label>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center rounded-md bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-xs font-mono text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700">
                image:transform
              </span>
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                (Standard transform & optimization access)
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isPending || name.trim().length < 2}
            >
              {isPending ? "Generating..." : "Create Secret Key"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
