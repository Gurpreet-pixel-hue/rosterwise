// Pure mapping from database-shaped rows to the engine's plain EngineInput. No Prisma import here, so
// the same function serves the DB loader (loadEngineInput.ts), the CLI and the tests, which feed it
// the in-memory seed.
import type {
  AssignmentRole,
  EngineInput,
  LeaveStatus,
  LeaveType,
  NeighbourRoster,
  OperatingRule,
  Weekday,
} from "../engine/types";

export interface EngineRows {
  employees: Array<{
    id: string;
    name: string;
    podId: string;
    isActive: boolean;
    weeklyOffsPerWeek: number;
    fixedOffDays: readonly Weekday[];
    preferredOffDays: readonly Weekday[];
    maxConsecutiveDays: number;
    maxDailyHours: number;
  }>;
  brands: Array<{ id: string; name: string; podId: string }>;
  processes: Array<{ id: string; code: string }>;
  brandProcesses: Array<{
    id: string;
    brandId: string;
    processId: string;
    operatingRule: OperatingRule;
    customWeekdays: readonly Weekday[];
    worksOnPublicHolidays: boolean;
    defaultMinStaff: number;
    /** JSON column: validated here, never trusted. */
    weekdayMinStaff: unknown;
    shiftStart: string;
    shiftEnd: string;
  }>;
  assignments: Array<{
    employeeId: string;
    brandProcessId: string;
    role: AssignmentRole;
    allocationPct: number;
  }>;
  holidays: Array<{ date: string; name: string }>;
  leaves: Array<{
    id: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
    type: LeaveType;
    status: LeaveStatus;
  }>;
  coverageOverrides: Array<{ brandProcessId: string; date: string; minStaff: number }>;
}

const WEEKDAYS: readonly string[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Validate the weekdayMinStaff JSON column: null, or an object of weekday -> integer >= 0. */
export function parseWeekdayMinStaff(raw: unknown): Partial<Record<Weekday, number>> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`weekdayMinStaff must be an object, got ${JSON.stringify(raw)}`);
  }
  const out: Partial<Record<Weekday, number>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!WEEKDAYS.includes(k)) throw new Error(`weekdayMinStaff has unknown weekday "${k}"`);
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(`weekdayMinStaff.${k} must be an integer >= 0, got ${JSON.stringify(v)}`);
    }
    out[k as Weekday] = v;
  }
  return Object.keys(out).length === 0 ? null : out;
}

export interface BuildExtras {
  today?: string;
  neighbourRosters?: NeighbourRoster[];
}

export function buildEngineInput(
  rows: EngineRows,
  month: string,
  extras: BuildExtras = {},
): EngineInput {
  const brandById = new Map(rows.brands.map((b) => [b.id, b]));
  const processById = new Map(rows.processes.map((p) => [p.id, p]));
  return {
    month,
    today: extras.today,
    employees: rows.employees.map((e) => ({ ...pick(e) })),
    brandProcesses: rows.brandProcesses.map((bp) => {
      const brand = brandById.get(bp.brandId);
      const proc = processById.get(bp.processId);
      if (!brand || !proc)
        throw new Error(`BrandProcess ${bp.id} references a missing brand or process`);
      return {
        id: bp.id,
        brandId: brand.id,
        brandName: brand.name,
        brandPodId: brand.podId,
        processCode: proc.code,
        operatingRule: bp.operatingRule,
        customWeekdays: [...bp.customWeekdays],
        worksOnPublicHolidays: bp.worksOnPublicHolidays,
        defaultMinStaff: bp.defaultMinStaff,
        weekdayMinStaff: parseWeekdayMinStaff(bp.weekdayMinStaff),
        shiftStart: bp.shiftStart,
        shiftEnd: bp.shiftEnd,
      };
    }),
    assignments: rows.assignments.map((a) => ({
      employeeId: a.employeeId,
      brandProcessId: a.brandProcessId,
      role: a.role,
      allocationPct: a.allocationPct,
    })),
    holidays: rows.holidays.map((h) => ({ date: h.date, name: h.name })),
    leaves: rows.leaves.map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      fromDate: l.fromDate,
      toDate: l.toDate,
      type: l.type,
      status: l.status,
    })),
    coverageOverrides: rows.coverageOverrides.map((o) => ({
      brandProcessId: o.brandProcessId,
      date: o.date,
      minStaff: o.minStaff,
    })),
    neighbourRosters: extras.neighbourRosters,
  };
}

function pick(e: EngineRows["employees"][number]) {
  return {
    id: e.id,
    name: e.name,
    podId: e.podId,
    isActive: e.isActive,
    weeklyOffsPerWeek: e.weeklyOffsPerWeek,
    fixedOffDays: [...e.fixedOffDays],
    preferredOffDays: [...e.preferredOffDays],
    maxConsecutiveDays: e.maxConsecutiveDays,
    maxDailyHours: e.maxDailyHours,
  };
}
