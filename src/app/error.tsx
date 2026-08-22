"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Something went wrong
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          An unexpected error occurred while loading this page.
        </p>
      </div>
      <div>
        <Button onClick={() => reset()} variant="outline" size="sm">
          Try again
        </Button>
      </div>
    </div>
  );
}
