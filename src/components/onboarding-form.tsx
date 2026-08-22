"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { organizationNameSchema } from "@/lib/validations/organization";
import { handleCreateOrganization } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [generalError, setGeneralError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGeneralError(null);
    setFieldError(null);

    const validation = organizationNameSchema.safeParse(name);
    if (!validation.success) {
      setFieldError(validation.error.issues[0]?.message || "Invalid organization name");
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.set("name", validation.data);

      const result = await handleCreateOrganization(null, formData);

      if (result.error) {
        setGeneralError(result.error);
        setIsLoading(false);
        return;
      }

      if (result.fieldErrors?.name?.[0]) {
        setFieldError(result.fieldErrors.name[0]);
        setIsLoading(false);
        return;
      }

      if (result.success) {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (error) {
      console.error("Onboarding failed:", error);
      setGeneralError("An unexpected error occurred. Please try again.");
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
        <Label htmlFor="onboarding-org-name">Organization Name</Label>
        <Input
          id="onboarding-org-name"
          name="name"
          type="text"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Corp or Personal Team"
          error={!!fieldError}
          aria-describedby={fieldError ? "org-name-error" : "org-name-hint"}
          disabled={isLoading}
        />
        {fieldError ? (
          <p id="org-name-error" className="text-xs text-red-600 dark:text-red-400">
            {fieldError}
          </p>
        ) : (
          <p id="org-name-hint" className="text-xs text-neutral-500 dark:text-neutral-400">
            This workspace will hold your API keys, usage metrics, and team access.
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Creating workspace..." : "Create Organization & Continue"}
      </Button>
    </form>
  );
}
