"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth/client";
import { signInSchema } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<{ email?: string; password?: string }>({});
  const [generalError, setGeneralError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const validation = signInSchema.safeParse({ email, password });
    if (!validation.success) {
      const formatted = validation.error.format();
      setFieldErrors({
        email: formatted.email?._errors[0],
        password: formatted.password?._errors[0],
      });
      return;
    }

    setIsLoading(true);

    try {
      const res = await signIn.email({
        email: validation.data.email,
        password: validation.data.password,
      });

      if (res.error) {
        // Use generic error message for security
        setGeneralError(res.error.message || "Invalid email or password. Please try again.");
        setIsLoading(false);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("Sign in failed:", error);
      setGeneralError("An unexpected error occurred during sign in. Please try again.");
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {generalError && (
        <div
          role="alert"
          aria-live="polite"
          className="p-3 text-sm rounded-md bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800"
        >
          {generalError}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="signin-email">Email Address</Label>
        <Input
          id="signin-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="developer@example.com"
          error={!!fieldErrors.email}
          aria-describedby={fieldErrors.email ? "signin-email-error" : undefined}
          disabled={isLoading}
        />
        {fieldErrors.email && (
          <p id="signin-email-error" className="text-xs text-red-600 dark:text-red-400">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="signin-password">Password</Label>
        </div>
        <Input
          id="signin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          error={!!fieldErrors.password}
          aria-describedby={fieldErrors.password ? "signin-password-error" : undefined}
          disabled={isLoading}
        />
        {fieldErrors.password && (
          <p id="signin-password-error" className="text-xs text-red-600 dark:text-red-400">
            {fieldErrors.password}
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Signing in..." : "Sign In"}
      </Button>

      <p className="text-center text-xs text-neutral-500 dark:text-neutral-400 pt-2">
        Don&apos;t have an account?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-neutral-900 dark:text-neutral-100 underline underline-offset-4 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          Create account
        </Link>
      </p>
    </form>
  );
}
