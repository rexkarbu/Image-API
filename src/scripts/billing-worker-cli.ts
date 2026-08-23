import "./register-server-only";
import * as dotenv from "dotenv";
import { runBillingWorker } from "../lib/services/billing-worker";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main() {
  console.log("=== Image-API Billing Background Worker CLI ===");
  try {
    const result = await runBillingWorker();
    console.log("Worker execution completed cleanly:");
    console.log(`- Webhooks Processed: ${result.processedWebhooks}`);
    console.log(`- Customers Provisioned: ${result.provisionedCustomers}`);
    console.log(`- Usage Batches Created: ${result.createdBatches}`);
    console.log(`- Usage Batches Reported: ${result.reportedBatches}`);
    if (result.errors.length > 0) {
      console.warn(`- Encountered ${result.errors.length} non-fatal warning(s).`);
    }
  } catch (err) {
    console.error("Worker execution failed:", (err as Error).message);
    process.exitCode = 1;
  }
}

main();
