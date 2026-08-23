/**
 * Pure Stripe configuration constants, supported webhook event allowlist,
 * and batch processing limits.
 */

export const STRIPE_SDK_VERSION = "22.5.0";
export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export const DEFAULT_METER_EVENT_NAME = "image_transform";

export const SUPPORTED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.created",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
] as const;

export type SupportedWebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

export const MAX_USAGE_BATCH_SIZE = 500;
export const MAX_USAGE_BATCH_WINDOW_MINUTES = 60;
export const STRIPE_METER_EVENT_ID_PREFIX = "imgapi_";
