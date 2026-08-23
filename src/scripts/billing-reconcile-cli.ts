import "./register-server-only";
import * as dotenv from "dotenv";
import { db } from "../db";
import { billingSubscriptions } from "../db/schema";
import { runReconciliationForOrganization } from "../lib/services/billing-reconciliation";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main() {
  console.log("=== Image-API Billing Reconciliation CLI ===");
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = now;

  try {
    const subscriptions = await db.select().from(billingSubscriptions);
    console.log(`Found ${subscriptions.length} active subscription(s) to reconcile.`);

    for (const sub of subscriptions) {
      console.log(`Reconciling organization ${sub.organizationId}...`);
      const res = await runReconciliationForOrganization(sub.organizationId, periodStart, periodEnd);
      console.log(
        `Result: status=${res.status}, localEligible=${res.localEligibleUnits}, reported=${res.reportedUnits}, stripeAggregated=${res.stripeAggregatedUnits}, diff=${res.difference}`
      );
    }
    console.log("Reconciliation complete.");
  } catch (err) {
    console.error("Reconciliation failed:", (err as Error).message);
    process.exitCode = 1;
  }
}

main();
