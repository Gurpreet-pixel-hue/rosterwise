// Idempotent demo seed. Running it twice yields the same database: it clears every table and
// re-inserts rows that have stable, hand-written ids. It therefore RESETS the database,
// including rosters, so it refuses to run against a non-local database unless
// SEED_ALLOW_REMOTE=1 is set (needed once for the production demo in P6).
import { Prisma, PrismaClient } from "@prisma/client";
import { buildSeedData } from "./seed-data";

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
  const d = buildSeedData();

  await prisma.$transaction(
    async (tx) => {
      // Clear, children first.
      await tx.auditLog.deleteMany();
      await tx.issueAck.deleteMany();
      await tx.rosterEntry.deleteMany();
      await tx.roster.deleteMany();
      await tx.coverageOverride.deleteMany();
      await tx.compOffCredit.deleteMany();
      await tx.leave.deleteMany();
      await tx.assignment.deleteMany();
      await tx.brandProcess.deleteMany();
      await tx.brand.deleteMany();
      await tx.process.deleteMany();
      await tx.publicHoliday.deleteMany();
      await tx.employee.deleteMany(); // Pod.leadId is SetNull, so this is safe before pods
      await tx.pod.deleteMany(); // Employee.podId is Restrict, so pods must go after employees

      // Insert. Pods first without leads (leads are employees who belong to a pod).
      await tx.pod.createMany({ data: d.pods.map((p) => ({ id: p.id, name: p.name })) });
      await tx.employee.createMany({ data: d.employees });
      for (const p of d.pods) {
        await tx.pod.update({ where: { id: p.id }, data: { leadId: p.leadId } });
      }
      await tx.process.createMany({ data: d.processes });
      await tx.brand.createMany({ data: d.brands });
      await tx.brandProcess.createMany({
        data: d.brandProcesses.map((bp) => ({
          ...bp,
          weekdayMinStaff: bp.weekdayMinStaff ?? Prisma.JsonNull,
        })),
      });
      await tx.assignment.createMany({ data: d.assignments });
      await tx.publicHoliday.createMany({ data: d.holidays });
      await tx.leave.createMany({ data: d.leaves });
      await tx.compOffCredit.createMany({ data: d.compOffCredits });
      await tx.coverageOverride.createMany({ data: d.coverageOverrides });
    },
    { timeout: 60_000 },
  );

  console.log(
    `Seeded: ${d.pods.length} pods, ${d.employees.length} employees, ${d.brands.length} brands, ` +
      `${d.brandProcesses.length} brand-processes, ${d.assignments.length} assignments, ` +
      `${d.holidays.length} holidays, ${d.leaves.length} leaves, ${d.compOffCredits.length} comp-off credits, ` +
      `${d.coverageOverrides.length} coverage overrides.`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
