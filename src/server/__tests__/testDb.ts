// Integration tests run against a REAL Postgres, named by TEST_DATABASE_URL. They wipe and re-seed it, so
// this guard refuses anything that could be the development or production database.
export function testDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const url = env.TEST_DATABASE_URL;
  if (!url) return null;
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL must point at a database whose name contains "test" (got "${name}").`,
    );
  }
  if (env.DATABASE_URL && env.DATABASE_URL === url) {
    throw new Error(
      "TEST_DATABASE_URL must differ from DATABASE_URL: tests wipe the database they run against.",
    );
  }
  return url;
}
