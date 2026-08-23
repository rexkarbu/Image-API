import { defineConfig } from "vitest/config";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
