import { defineConfig } from "vitest/config";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/setup.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/mocks/empty.ts"),
    },
  },
});
