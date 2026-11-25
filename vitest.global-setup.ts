// Before any test runs: if a test database is configured, bring its schema up to date. (Without
// TEST_DATABASE_URL the integration tests are skipped, and say so.)
import { execFileSync } from "node:child_process";
import { loadEnv } from "vite";
import { testDatabaseUrl } from "./src/server/__tests__/testDb";

export default function setup() {
  const env = { ...loadEnv("test", process.cwd(), ""), ...process.env } as Record<
    string,
    string | undefined
  >;
  const url = testDatabaseUrl(env);
  if (!url) {
    console.warn("\n[vitest] TEST_DATABASE_URL is not set: integration tests will be SKIPPED.\n");
    return;
  }
  execFileSync("pnpm", ["exec", "prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
