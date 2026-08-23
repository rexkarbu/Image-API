"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrganizationContext } from "@/lib/tenant/context";
import { createCheckoutSession, createPortalSession } from "@/lib/services/billing-checkout";
import { provisionStripeCustomer } from "@/lib/services/billing-customers";
import { runReconciliationForOrganization } from "@/lib/services/billing-reconciliation";

async function getRequestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function createCheckoutSessionAction(): Promise<void> {
  const tenantContext = await requireOrganizationContext();

  if (tenantContext.membership.role !== "owner") {
    throw new Error("Forbidden: Only organization owners can initiate Checkout.");
  }

  const origin = await getRequestOrigin();
  let checkoutUrl: string;

  try {
    checkoutUrl = await createCheckoutSession(
      tenantContext.organization.id,
      tenantContext.user.id,
      origin
    );
  } catch (err) {
    throw new Error((err as Error).message);
  }

  // Redirect must happen outside of try/catch
  redirect(checkoutUrl);
}

export async function createPortalSessionAction(): Promise<void> {
  const tenantContext = await requireOrganizationContext();

  if (tenantContext.membership.role !== "owner") {
    throw new Error("Forbidden: Only organization owners can open the Billing Portal.");
  }

  const origin = await getRequestOrigin();
  let portalUrl: string;

  try {
    portalUrl = await createPortalSession(tenantContext.organization.id, origin);
  } catch (err) {
    throw new Error((err as Error).message);
  }

  // Redirect must happen outside of try/catch
  redirect(portalUrl);
}

export async function retryCustomerProvisioningAction(): Promise<{ success: boolean; error?: string }> {
  const tenantContext = await requireOrganizationContext();

  if (tenantContext.membership.role !== "owner") {
    return { success: false, error: "Forbidden: Only organization owners can retry billing setup." };
  }

  try {
    await provisionStripeCustomer(tenantContext.organization.id);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function triggerReconciliationAction(): Promise<{ success: boolean; status?: string; error?: string }> {
  const tenantContext = await requireOrganizationContext();

  if (tenantContext.membership.role !== "owner") {
    return { success: false, error: "Forbidden: Only organization owners can trigger reconciliation." };
  }

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = now;

  try {
    const result = await runReconciliationForOrganization(
      tenantContext.organization.id,
      periodStart,
      periodEnd
    );
    return { success: true, status: result.status };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
