// The reusable half of the seed: clears every table and re-inserts the demo dataset with stable ids,
// so running it twice gives an identical database. Used by the seed CLI and by the integration tests.
import { Prisma, type PrismaClient } from "@prisma/client";
import { buildSeedData } from "./seed-data";

export interface SeedCounts {
  pods: number;
  employees: number;
  brands: number;
  brandProcesses: number;
  assignments: number;
  holidays: number;
  leaves: number;
  compOffCredits: number;
  coverageOverrides: number;
}

export async function seedDatabase(prisma: PrismaClient): Promise<SeedCounts> {
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

  return {
    pods: d.pods.length,
    employees: d.employees.length,
    brands: d.brands.length,
    brandProcesses: d.brandProcesses.length,
    assignments: d.assignments.length,
    holidays: d.holidays.length,
    leaves: d.leaves.length,
    compOffCredits: d.compOffCredits.length,
    coverageOverrides: d.coverageOverrides.length,
  };
}
