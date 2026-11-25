// Verifies the LIVE database against every bullet of CLAUDE.md section 5 and prints a table.
// Run after `pnpm db:push && pnpm db:seed`. Exits 1 if any check fails.
import { PrismaClient } from "@prisma/client";
import type { SeedSnapshot } from "../prisma/seed-data";
import {
  SINGLE_RESOURCE_FORMULA,
  brandStructures,
  runSeedChecks,
  singleResourcePct,
} from "./seed-checks";

const prisma = new PrismaClient();

async function loadSnapshot(): Promise<SeedSnapshot> {
  const [
    pods,
    employees,
    brands,
    processes,
    brandProcesses,
    assignments,
    holidays,
    leaves,
    credits,
    overrides,
  ] = await Promise.all([
    prisma.pod.findMany(),
    prisma.employee.findMany(),
    prisma.brand.findMany(),
    prisma.process.findMany(),
    prisma.brandProcess.findMany(),
    prisma.assignment.findMany(),
    prisma.publicHoliday.findMany(),
    prisma.leave.findMany(),
    prisma.compOffCredit.findMany(),
    prisma.coverageOverride.findMany(),
  ]);
  return {
    pods: pods.map((p) => ({ id: p.id, name: p.name, leadId: p.leadId ?? "" })),
    employees,
    brands,
    processes,
    brandProcesses: brandProcesses.map((bp) => ({
      ...bp,
      weekdayMinStaff: (bp.weekdayMinStaff ??
        null) as SeedSnapshot["brandProcesses"][number]["weekdayMinStaff"],
    })),
    assignments,
    holidays: holidays.map((h) => ({ id: h.id, date: h.date, name: h.name })),
    leaves,
    compOffCredits: credits,
    coverageOverrides: overrides,
  };
}

async function main() {
  const snap = await loadSnapshot();
  const results = runSeedChecks(snap);
  const empName = new Map(snap.employees.map((e) => [e.id, e.name]));

  console.log("\nRosterWise seed verification\n");
  const w = Math.max(...results.map((r) => r.label.length));
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label.padEnd(w)}  ${r.detail}`);
  }

  const structures = brandStructures(snap);
  const singles = structures.filter((b) => b.isSingleResource).length;
  console.log(
    `\nSingle-resource brands: ${singles}/${structures.length} = ${singleResourcePct(snap).toFixed(1)}%`,
  );
  console.log(`  definition: ${SINGLE_RESOURCE_FORMULA}`);

  console.log("\nBrand staffing (PRIMARY employees)");
  const bw = Math.max(...structures.map((b) => b.brand.length));
  for (const b of structures) {
    console.log(
      `  ${b.brand.padEnd(bw)}  ${b.isSingleResource ? "single" : "multi "}  ${b.primaryEmployeeIds
        .map((id) => empName.get(id))
        .join(", ")}`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
