import "server-only";
import { eq, and, notInArray, inArray } from "drizzle-orm";
import { db, DbClient } from "@/db";
import {
  billingCustomers,
  billingSubscriptions,
  billingCheckoutSessions,
} from "@/db/schema";
import { getStripeClient } from "@/lib/stripe/client";
import { getValidatedStripeConfig } from "@/lib/stripe/safety";
import { provisionStripeCustomer } from "./billing-customers";
import Stripe from "stripe";

function sanitizeErrorCode(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) {
    return err.code || err.type || "stripe_error";
  }
  if (err instanceof Error) {
    return err.name || "checkout_error";
  }
  return "checkout_error";
}

export async function createCheckoutSession(
  organizationId: string,
  actorUserId: string,
  origin: string,
  client: DbClient = db
): Promise<string> {
  // 1. Check if organization already has an active subscription
  const [existingSub] = await client
    .select()
    .from(billingSubscriptions)
    .where(
      and(
        eq(billingSubscriptions.organizationId, organizationId),
        notInArray(billingSubscriptions.status, ["canceled", "incomplete_expired"])
      )
    )
    .limit(1);

  if (existingSub) {
    throw new Error("Organization already has an active or pending subscription.");
  }

  // 2. Check if an active checkout session is already in-flight
  const [existingCheckout] = await client
    .select()
    .from(billingCheckoutSessions)
    .where(
      and(
        eq(billingCheckoutSessions.organizationId, organizationId),
        inArray(billingCheckoutSessions.status, ["creating", "open"])
      )
    )
    .limit(1);

  if (existingCheckout) {
    // If open and has an unexpired URL, or if expired, handle cleanly
    if (existingCheckout.expiresAt && existingCheckout.expiresAt < new Date()) {
      await client
        .update(billingCheckoutSessions)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(billingCheckoutSessions.id, existingCheckout.id));
    } else {
      throw new Error("A Checkout session is already open for this organization. Please complete or wait for it to expire.");
    }
  }

  // 3. Ensure Stripe customer is provisioned
  const stripeCustomerId = await provisionStripeCustomer(organizationId, client);

  // 4. Create local checkout attempt record
  const attemptId = crypto.randomUUID();
  const idempotencyKey = `chk_${attemptId}`;
  const now = new Date();

  await client.insert(billingCheckoutSessions).values({
    id: attemptId,
    organizationId,
    actorUserId,
    idempotencyKey,
    status: "creating",
    createdAt: now,
    updatedAt: now,
  });

  const config = getValidatedStripeConfig();
  const stripe = getStripeClient();

  const successUrl = `${origin}/dashboard/billing?checkout=success`;
  const cancelUrl = `${origin}/dashboard/billing?checkout=canceled`;

  try {
    const session = await stripe.checkout.sessions.create(
      {
        customer: stripeCustomerId,
        mode: "subscription",
        line_items: [
          {
            price: config.meteredPriceId,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          organizationId,
          attemptId,
        },
        subscription_data: {
          metadata: {
            organizationId,
          },
        },
      },
      { idempotencyKey: `cs_idem_${attemptId}` }
    );

    if (!session.url) {
      throw new Error("Stripe did not return a valid Checkout Session URL.");
    }

    const expiresAt = session.expires_at ? new Date(session.expires_at * 1000) : null;

    await client
      .update(billingCheckoutSessions)
      .set({
        stripeCheckoutSessionId: session.id,
        status: "open",
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(billingCheckoutSessions.id, attemptId));

    return session.url;
  } catch (error) {
    const errorCode = sanitizeErrorCode(error);
    await client
      .update(billingCheckoutSessions)
      .set({
        status: "failed",
        errorCode,
        updatedAt: new Date(),
      })
      .where(eq(billingCheckoutSessions.id, attemptId));

    throw new Error(`Failed to create Checkout Session: ${errorCode}`);
  }
}

export async function createPortalSession(
  organizationId: string,
  origin: string,
  client: DbClient = db
): Promise<string> {
  const [cust] = await client
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.organizationId, organizationId))
    .limit(1);

  if (!cust || !cust.stripeCustomerId || cust.provisioningStatus !== "ready") {
    throw new Error("No active Stripe Customer profile found for this organization.");
  }

  const stripe = getStripeClient();
  const returnUrl = `${origin}/dashboard/billing`;

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: cust.stripeCustomerId,
      return_url: returnUrl,
    });

    return portalSession.url;
  } catch (error) {
    const errorCode = sanitizeErrorCode(error);
    throw new Error(`Failed to open Billing Customer Portal: ${errorCode}`);
  }
}
