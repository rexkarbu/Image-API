import "server-only";
import { eq } from "drizzle-orm";
import { db, DbClient } from "@/db";
import { billingCustomers, organizations, organizationMembers, user } from "@/db/schema";
import { getStripeClient } from "@/lib/stripe/client";
import Stripe from "stripe";

function sanitizeStripeError(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) {
    return err.code || err.type || "stripe_error";
  }
  if (err instanceof Error) {
    return err.name || "unknown_error";
  }
  return "unknown_error";
}

/**
 * Idempotently provisions a Stripe Customer for an organization.
 * Network I/O is executed outside of database transactions.
 */
export async function provisionStripeCustomer(
  organizationId: string,
  client: DbClient = db
): Promise<string> {
  const [record] = await client
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.organizationId, organizationId))
    .limit(1);

  if (!record) {
    throw new Error(`Billing customer record not found for organization: ${organizationId}`);
  }

  if (record.provisioningStatus === "ready" && record.stripeCustomerId) {
    return record.stripeCustomerId;
  }

  // Fetch organization and owner user details for customer metadata
  const [org] = await client
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!org) {
    throw new Error(`Organization ${organizationId} not found.`);
  }

  const [ownerMembership] = await client
    .select({
      user: user,
    })
    .from(organizationMembers)
    .innerJoin(user, eq(organizationMembers.userId, user.id))
    .where(eq(organizationMembers.organizationId, organizationId))
    .limit(1);

  const idempotencyKey = `bprov_${organizationId}_${record.provisioningIdempotencyKey}`;
  const stripe = getStripeClient();

  try {
    const customer = await stripe.customers.create(
      {
        name: org.name,
        email: ownerMembership?.user.email || undefined,
        metadata: {
          organizationId: org.id,
        },
      },
      { idempotencyKey }
    );

    const now = new Date();
    await client
      .update(billingCustomers)
      .set({
        stripeCustomerId: customer.id,
        provisioningStatus: "ready",
        livemode: customer.livemode,
        attemptCount: record.attemptCount + 1,
        lastErrorCode: null,
        nextRetryAt: null,
        updatedAt: now,
      })
      .where(eq(billingCustomers.organizationId, organizationId));

    return customer.id;
  } catch (error) {
    const errorCode = sanitizeStripeError(error);
    const attemptCount = record.attemptCount + 1;
    // Bounded exponential backoff: 5s, 10s, 20s, 40s ... up to 1 hr
    const backoffMs = Math.min(3600 * 1000, Math.pow(2, attemptCount) * 5000);
    const nextRetryAt = new Date(Date.now() + backoffMs);

    await client
      .update(billingCustomers)
      .set({
        provisioningStatus: "failed",
        attemptCount,
        lastErrorCode: errorCode,
        nextRetryAt,
        updatedAt: new Date(),
      })
      .where(eq(billingCustomers.organizationId, organizationId));

    throw new Error(`Failed to provision Stripe customer for organization ${organizationId}: ${errorCode}`);
  }
}

/**
 * Safe wrapper that attempts customer provisioning after onboarding commit without throwing.
 */
export async function provisionStripeCustomerSafe(
  organizationId: string,
  client: DbClient = db
): Promise<void> {
  try {
    await provisionStripeCustomer(organizationId, client);
  } catch (err) {
    console.warn(`[Billing] Safe customer provisioning deferred for org ${organizationId}:`, (err as Error).message);
  }
}
