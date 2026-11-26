// Everything the roster and setup pages need besides the roster itself: names and rules for pods,
// employees, brands, brand-processes, assignments, holidays and leave. One read, plain serialisable data.
import type { PrismaClient } from "@prisma/client";
import { monthDates, weeksOfMonth } from "../engine/calendar";
import { loadEngineInput } from "./loadEngineInput";
import {
  getRoster,
  latestRoster,
  listRosterVersions,
  type RosterSummary,
  type RosterView,
} from "./services/roster";

export interface RosterRefs {
  pods: Array<{ id: string; name: string; leadId: string | null }>;
  employees: Array<{
    id: string;
    name: string;
    podId: string;
    isActive: boolean;
    preferredOffDays: string[];
    fixedOffDays: string[];
  }>;
  brands: Array<{ id: string; name: string; podId: string }>;
  brandProcesses: Array<{
    id: string;
    brandId: string;
    brandName: string;
    brandPodId: string;
    processCode: string;
    operatingRule: string;
    defaultMinStaff: number;
    shiftStart: string;
    shiftEnd: string;
  }>;
  assignments: Array<{
    employeeId: string;
    brandProcessId: string;
    role: "PRIMARY" | "BACKUP";
    allocationPct: number;
  }>;
  holidays: Array<{ date: string; name: string }>;
  leaves: Array<{
    id: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
    type: string;
    status: string;
  }>;
}

export interface RosterPageData {
  month: string;
  /** Every date shown: the whole Mon-Sun planning window, spill days included. */
  window: string[];
  /** The dates inside the month (coverage and per-day rules apply to these). */
  monthDates: string[];
  versions: RosterSummary[];
  /** The latest version's view, or null when the month has not been generated yet. */
  view: RosterView | null;
  refs: RosterRefs;
}

export async function loadRefs(prisma: PrismaClient, month: string): Promise<RosterRefs> {
  const [input, pods, brands] = await Promise.all([
    loadEngineInput(prisma, month),
    prisma.pod.findMany({ orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    pods: pods.map((p) => ({ id: p.id, name: p.name, leadId: p.leadId })),
    employees: input.employees.map((e) => ({
      id: e.id,
      name: e.name,
      podId: e.podId,
      isActive: e.isActive,
      preferredOffDays: [...e.preferredOffDays],
      fixedOffDays: [...e.fixedOffDays],
    })),
    brands: brands.map((b) => ({ id: b.id, name: b.name, podId: b.podId })),
    brandProcesses: input.brandProcesses.map((b) => ({
      id: b.id,
      brandId: b.brandId,
      brandName: b.brandName,
      brandPodId: b.brandPodId,
      processCode: b.processCode,
      operatingRule: b.operatingRule,
      defaultMinStaff: b.defaultMinStaff,
      shiftStart: b.shiftStart,
      shiftEnd: b.shiftEnd,
    })),
    assignments: input.assignments.map((a) => ({ ...a })),
    holidays: input.holidays.map((h) => ({ date: h.date, name: h.name })),
    leaves: input.leaves.map((l) => ({ ...l })),
  };
}

export async function loadRosterPage(prisma: PrismaClient, month: string): Promise<RosterPageData> {
  const [latest, versions, refs] = await Promise.all([
    latestRoster(prisma, month),
    listRosterVersions(prisma, month),
    loadRefs(prisma, month),
  ]);
  const view = latest ? await getRoster(prisma, latest.id, { suggestions: true }) : null;
  return {
    month,
    window: weeksOfMonth(month).flatMap((w) => w.fullWeek),
    monthDates: monthDates(month),
    versions,
    view,
    refs,
  };
}

/** id -> readable label for every kind of thing a master-data row can point at. */
export async function loadLookups(prisma: PrismaClient) {
  const [pods, employees, brands, processes, bps] = await Promise.all([
    prisma.pod.findMany(),
    prisma.employee.findMany(),
    prisma.brand.findMany(),
    prisma.process.findMany(),
    prisma.brandProcess.findMany({ include: { brand: true, process: true } }),
  ]);
  return {
    pod: Object.fromEntries(pods.map((p) => [p.id, p.name])),
    employee: Object.fromEntries(employees.map((e) => [e.id, e.name])),
    brandName: Object.fromEntries(brands.map((b) => [b.id, b.name])),
    processCode: Object.fromEntries(processes.map((p) => [p.id, p.code])),
    brandProcess: Object.fromEntries(bps.map((b) => [b.id, `${b.brand.name} / ${b.process.code}`])),
  };
}
