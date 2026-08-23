import { assertDevelopmentDatabaseSafety } from "@/db/development-safety";
import * as dotenv from "dotenv";

export function setup() {
  dotenv.config({ path: ".env.local" });
  dotenv.config({ path: ".env" });
  assertDevelopmentDatabaseSafety();
}
