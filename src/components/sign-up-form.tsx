"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth/client";
import { signUpSchema } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});
  const [generalError, setGeneralError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const validation = signUpSchema.safeParse({ name, email, password });
    if (!validation.success) {
      const formatted = validation.error.format();
      setFieldErrors({
        name: formatted.name?._errors[0],
        email: formatted.email?._errors[0],
        password: formatted.password?._errors[0],
      });
      return;
    }

    setIsLoading(true);

    try {
      const res = await signUp.email({
        name: validation.data.name,
        email: validation.data.email,
        password: validation.data.password,
      });

      if (res.error) {
        setGeneralError(res.error.message || "Failed to create account. Please try again.");
        setIsLoading(false);
        return;
      }

      // New users must complete organization onboarding
      router.push("/onboarding");
      router.refresh();
    } catch (error) {
      console.error("Sign up failed:", error);
      setGeneralError("An unexpected error occurred during account creation. Please try again.");
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
        <Label htmlFor="signup-name">Full Name</Label>
        <Input
          id="signup-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Doe"
          error={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? "signup-name-error" : undefined}
          disabled={isLoading}
        />
        {fieldErrors.name && (
          <p id="signup-name-error" className="text-xs text-red-600 dark:text-red-400">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-email">Email Address</Label>
        <Input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="developer@example.com"
          error={!!fieldErrors.email}
          aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
          disabled={isLoading}
        />
        {fieldErrors.email && (
          <p id="signup-email-error" className="text-xs text-red-600 dark:text-red-400">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min 8 characters"
          error={!!fieldErrors.password}
          aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
          disabled={isLoading}
        />
        {fieldErrors.password && (
          <p id="signup-password-error" className="text-xs text-red-600 dark:text-red-400">
            {fieldErrors.password}
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Creating account..." : "Create Account"}
      </Button>

      <p className="text-center text-xs text-neutral-500 dark:text-neutral-400 pt-2">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-neutral-900 dark:text-neutral-100 underline underline-offset-4 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
