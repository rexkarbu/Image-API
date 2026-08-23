"use client";

import { useState, useTransition } from "react";
import { createCheckoutSessionAction } from "@/actions/billing";
import { CreditCard, Loader2 } from "lucide-react";

export function CheckoutButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = () => {
    setError(null);
    startTransition(async () => {
      try {
        await createCheckoutSessionAction();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={handleCheckout}
        disabled={isPending}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:pointer-events-none disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Redirecting to Checkout...</span>
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" />
            <span>Subscribe with Stripe Checkout</span>
          </>
        )}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
