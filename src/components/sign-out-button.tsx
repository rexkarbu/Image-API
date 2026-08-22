"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    setIsLoading(true);
    try {
      await signOut();
      router.push("/sign-in");
      router.refresh();
    } catch (error) {
      console.error("Sign out error:", error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSignOut}
      disabled={isLoading}
      aria-label="Sign out of your account"
    >
      {isLoading ? "Signing out..." : "Sign Out"}
    </Button>
  );
}
