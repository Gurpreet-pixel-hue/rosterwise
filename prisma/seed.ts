// Idempotent demo seed. Running it twice yields the same database: it clears every table and
// re-inserts rows that have stable, hand-written ids. It therefore RESETS the database,
// including rosters, so it refuses to run against a non-local database unless
// SEED_ALLOW_REMOTE=1 is set (needed once for the production demo in P6).
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "./seed-lib";

const prisma = new PrismaClient();

function assertSafeTarget() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env).");
  const host = new URL(url).hostname;
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!isLocal && process.env.SEED_ALLOW_REMOTE !== "1") {
    throw new Error(
      `Refusing to reset a non-local database (${host}). Set SEED_ALLOW_REMOTE=1 to confirm.`,
    );
  }
}

async function main() {
  assertSafeTarget();
  const c = await seedDatabase(prisma);
  console.log(
    `Seeded: ${c.pods} pods, ${c.employees} employees, ${c.brands} brands, ` +
      `${c.brandProcesses} brand-processes, ${c.assignments} assignments, ` +
      `${c.holidays} holidays, ${c.leaves} leaves, ${c.compOffCredits} comp-off credits, ` +
      `${c.coverageOverrides} coverage overrides.`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
