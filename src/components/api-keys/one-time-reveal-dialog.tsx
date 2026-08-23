"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

interface OneTimeRevealDialogProps {
  plaintextKey: string | null;
  keyName: string;
  onClose: () => void;
}

export function OneTimeRevealDialog({
  plaintextKey,
  keyName,
  onClose,
}: OneTimeRevealDialogProps) {
  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const acknowledgeButtonRef = React.useRef<HTMLButtonElement>(null);

  // Clear timeout on unmount to prevent leaks
  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Move initial focus into acknowledge button
  React.useEffect(() => {
    if (plaintextKey && acknowledgeButtonRef.current) {
      acknowledgeButtonRef.current.focus();
    }
  }, [plaintextKey]);

  if (!plaintextKey) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plaintextKey);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard write failed
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Trap focus inside modal
    if (e.key === "Tab" && dialogRef.current) {
      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reveal-dialog-title"
      aria-describedby="reveal-dialog-desc"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95"
      >
        <div className="space-y-1.5">
          <div className="flex items-center space-x-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
              ✓
            </span>
            <h2 id="reveal-dialog-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              API Key Generated Successfully
            </h2>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            API Key for <strong className="text-neutral-900 dark:text-neutral-100">{keyName}</strong>
          </p>
        </div>

        <div
          id="reveal-dialog-desc"
          className="rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-xs text-amber-800 dark:text-amber-300 space-y-1"
        >
          <p className="font-semibold">⚠️ Important Security Notice</p>
          <p>
            Copy and store this secret key in a secure vault now. For your security,{" "}
            <strong>this secret key will never be shown again</strong>. If lost, you will need to rotate or generate a new key.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="plaintext-key-input" className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
            Plaintext Secret Key
          </label>
          <div className="flex items-center space-x-2">
            <input
              id="plaintext-key-input"
              type="text"
              readOnly
              value={plaintextKey}
              className="flex-1 font-mono text-xs px-3 py-2.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 select-all focus:outline-none focus:ring-2 focus:ring-neutral-500"
            />
            <Button
              type="button"
              variant={copied ? "default" : "outline"}
              size="sm"
              onClick={handleCopy}
              className="h-9 px-4 shrink-0 font-medium"
            >
              {copied ? "Copied! ✓" : "Copy Key"}
            </Button>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            ref={acknowledgeButtonRef}
            type="button"
            variant="default"
            size="default"
            onClick={onClose}
            className="w-full sm:w-auto"
          >
            I have saved this key safely
          </Button>
        </div>
      </div>
    </div>
  );
}
