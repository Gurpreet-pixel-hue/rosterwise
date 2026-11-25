// Database -> EngineInput. The only place the engine's data is read from Postgres; the mapping itself
// is the pure buildEngineInput(), which the tests run against the in-memory seed.
import type { PrismaClient } from "@prisma/client";
import type { DraftEntry, EngineInput, NeighbourRoster } from "../engine/types";
import { buildEngineInput, type BuildExtras } from "./buildEngineInput";

export interface LoadOptions {
  today?: string;
}

/** Month before and after `month` (YYYY-MM). */
function adjacentMonths(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const fmt = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}`;
  return [m === 1 ? fmt(y - 1, 12) : fmt(y, m - 1), m === 12 ? fmt(y + 1, 1) : fmt(y, m + 1)];
}

/** The latest version (any status) of the neighbouring months' rosters, as locked context. */
export async function loadNeighbourRosters(
  prisma: PrismaClient,
  month: string,
): Promise<NeighbourRoster[]> {
  const out: NeighbourRoster[] = [];
  for (const m of adjacentMonths(month)) {
    const roster = await prisma.roster.findFirst({
      where: { month: m },
      orderBy: { version: "desc" },
      include: { entries: true },
    });
    if (!roster) continue;
    const entries: DraftEntry[] = roster.entries.map((e) => ({
      employeeId: e.employeeId,
      date: e.date,
      status: e.status,
      coveredBrandProcessIds: e.coveredBrandProcessIds,
      locked: e.locked,
      source: e.source,
    }));
    out.push({ month: m, status: roster.status, entries });
  }
  return out;
}

export async function loadEngineInput(
  prisma: PrismaClient,
  month: string,
  opts: LoadOptions = {},
): Promise<EngineInput> {
  const [
    employees,
    brands,
    processes,
    brandProcesses,
    assignments,
    holidays,
    leaves,
    overrides,
    neighbours,
  ] = await Promise.all([
    prisma.employee.findMany(),
    prisma.brand.findMany(),
    prisma.process.findMany(),
    prisma.brandProcess.findMany(),
    prisma.assignment.findMany(),
    prisma.publicHoliday.findMany(),
    prisma.leave.findMany(),
    prisma.coverageOverride.findMany(),
    loadNeighbourRosters(prisma, month),
  ]);
  const extras: BuildExtras = { today: opts.today, neighbourRosters: neighbours };
  return buildEngineInput(
    {
      employees,
      brands,
      processes,
      brandProcesses,
      assignments,
      holidays,
      leaves,
      coverageOverrides: overrides,
    },
    month,
    extras,
  );
}
