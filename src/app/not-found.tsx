import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center space-y-4">
      <div className="space-y-1">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          404
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          The requested page could not be found.
        </p>
      </div>
      <div>
        <Link href="/">
          <Button variant="outline" size="sm">
            Return Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
