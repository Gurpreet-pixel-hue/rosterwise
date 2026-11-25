import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // .env values (TEST_DATABASE_URL) reach the tests; CI passes them as real environment variables.
    env: loadEnv(mode, process.cwd(), ""),
    globalSetup: ["./vitest.global-setup.ts"],
    // Integration tests share one database, so test files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}));
