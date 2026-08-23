/**
 * Pure DTOs and view models for billing, subscriptions, invoices, and reconciliation.
 * Safe for Client Components and pure test execution.
 */

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired";

export type CustomerProvisioningStatus = "pending" | "ready" | "failed";

export type InvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

export type ReconciliationState = "pending_provider" | "matched" | "mismatch" | "failed";

export interface BillingCustomerDto {
  organizationId: string;
  stripeCustomerId: string | null;
  provisioningStatus: CustomerProvisioningStatus;
  livemode: boolean;
  attemptCount: number;
  lastErrorCode: string | null;
}

export interface BillingSubscriptionDto {
  id: string;
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string; // ISO 8601
  currentPeriodEnd: string; // ISO 8601
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  meteringEnabledAt: string;
}

export interface BillingInvoiceDto {
  id: string;
  stripeInvoiceId: string;
  status: InvoiceStatus;
  currency: string;
  amountDue: number; // Smallest currency unit (cents)
  amountPaid: number;
  periodStart: string;
  periodEnd: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface BillingUsageSummaryDto {
  currentPeriodLocalUnits: number;
  reportedUnits: number;
  pendingUnits: number;
  manualReviewUnits: number;
  lastReconciliationStatus: ReconciliationState | null;
  lastReconciliationAt: string | null;
}

export interface BillingDashboardData {
  organizationId: string;
  organizationName: string;
  isOwner: boolean;
  isTestMode: boolean;
  customer: BillingCustomerDto | null;
  subscription: BillingSubscriptionDto | null;
  usage: BillingUsageSummaryDto;
  invoices: BillingInvoiceDto[];
}
