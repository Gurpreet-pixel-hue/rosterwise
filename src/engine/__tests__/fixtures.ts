// Test fixtures. `coverageOf`, `entry` etc. recompute facts from the raw draft WITHOUT calling the
// engine's own validator, so the tests cannot be tautological.
import type {
  DraftEntry,
  EngineAssignment,
  EngineBrandProcess,
  EngineEmployee,
  EngineInput,
  EngineLeave,
  Issue,
  IssueCode,
  RosterDraft,
  Weekday,
} from "../types";

export const emp = (id: string, over: Partial<EngineEmployee> = {}): EngineEmployee => ({
  id,
  name: id,
  podId: "pod1",
  isActive: true,
  weeklyOffsPerWeek: 1,
  fixedOffDays: [],
  preferredOffDays: [],
  maxConsecutiveDays: 6,
  maxDailyHours: 9,
  ...over,
});

export const bp = (id: string, over: Partial<EngineBrandProcess> = {}): EngineBrandProcess => ({
  id,
  brandId: `brand-${id}`,
  brandName: `Brand ${id}`,
  brandPodId: "pod1",
  processCode: "CS",
  operatingRule: "ALL_DAYS",
  customWeekdays: [],
  worksOnPublicHolidays: false,
  defaultMinStaff: 1,
  weekdayMinStaff: null,
  shiftStart: "09:00",
  shiftEnd: "18:00",
  ...over,
});

export const primary = (
  employeeId: string,
  brandProcessId: string,
  allocationPct = 100,
): EngineAssignment => ({
  employeeId,
  brandProcessId,
  role: "PRIMARY",
  allocationPct,
});
export const backup = (
  employeeId: string,
  brandProcessId: string,
  allocationPct = 100,
): EngineAssignment => ({
  employeeId,
  brandProcessId,
  role: "BACKUP",
  allocationPct,
});

let leaveSeq = 0;
export const leave = (
  employeeId: string,
  fromDate: string,
  toDate: string,
  over: Partial<EngineLeave> = {},
): EngineLeave => ({
  id: `L${++leaveSeq}`,
  employeeId,
  fromDate,
  toDate,
  type: "PLANNED",
  status: "APPROVED",
  ...over,
});

export function makeInput(over: Partial<EngineInput> & { month?: string } = {}): EngineInput {
  return {
    month: "2026-12",
    employees: [],
    brandProcesses: [],
    assignments: [],
    holidays: [],
    leaves: [],
    coverageOverrides: [],
    ...over,
  };
}

// ---- independent readers of a draft --------------------------------------------------------

export const entry = (d: RosterDraft, employeeId: string, date: string): DraftEntry => {
  const e = d.entries.find((x) => x.employeeId === employeeId && x.date === date);
  if (!e) throw new Error(`no entry for ${employeeId} on ${date}`);
  return e;
};

/** Number of assigned employees who are WORKing on `date` and cover `bpId`. */
export function coverageOf(input: EngineInput, d: RosterDraft, bpId: string, date: string): number {
  const assigned = new Set(
    input.assignments.filter((a) => a.brandProcessId === bpId).map((a) => a.employeeId),
  );
  return d.entries.filter(
    (e) =>
      e.date === date &&
      e.status === "WORK" &&
      assigned.has(e.employeeId) &&
      e.coveredBrandProcessIds.includes(bpId),
  ).length;
}

export const offDates = (d: RosterDraft, employeeId: string): string[] =>
  d.entries
    .filter((e) => e.employeeId === employeeId && e.status === "WEEKLY_OFF")
    .map((e) => e.date)
    .sort();

export const issuesOf = (issues: Issue[], code: IssueCode) => issues.filter((i) => i.code === code);
export const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "ERROR");

const WD: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const weekdayOfTest = (date: string): Weekday => {
  const [y, m, d] = date.split("-").map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};
