import dns from "node:dns";
import { assertDevelopmentDatabaseSafety } from "@/db/development-safety";
import * as dotenv from "dotenv";

export function setup() {
  dns.setDefaultResultOrder("ipv4first");
  dotenv.config({ path: ".env.local" });
  dotenv.config({ path: ".env" });
  assertDevelopmentDatabaseSafety();
}
