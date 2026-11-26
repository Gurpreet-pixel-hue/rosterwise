// Pure helpers behind the roster page: which people and brand-processes each of the five views shows, the
// "who is working on <date>" panel, cell codes and issue lookups. No React and no I/O, so every rule here is
// unit-tested (roster-view.test.ts). The page draws what these return; it decides nothing itself.
import { addDays } from "@/engine/calendar";
import type { DraftEntry, Issue } from "@/engine/types";
import type { RosterRefs } from "@/server/pageData";

export const VIEW_KINDS = ["company", "pod", "brand", "process", "employee"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export const VIEW_LABEL: Record<ViewKind, string> = {
  company: "Company",
  pod: "Pod",
  brand: "Brand",
  process: "Process",
  employee: "Employee",
};

type Refs = RosterRefs;
export interface Option {
  value: string;
  label: string;
}

/** Choices for a view's filter (empty for Company, which has no filter). */
export function filterOptions(kind: ViewKind, refs: Refs): Option[] {
  switch (kind) {
    case "company":
      return [];
    case "pod":
      return refs.pods.map((p) => ({ value: p.id, label: p.name }));
    case "brand":
      return refs.brands.map((b) => ({ value: b.id, label: b.name }));
    case "process": {
      const codes = [...new Set(refs.brandProcesses.map((b) => b.processCode))].sort();
      return codes.map((c) => ({ value: c, label: c }));
    }
    case "employee":
      return refs.employees.filter((e) => e.isActive).map((e) => ({ value: e.id, label: e.name }));
  }
}

/** Brand-processes the view is about (the rows of the coverage strip). */
export function visibleBrandProcesses(kind: ViewKind, value: string, refs: Refs) {
  const bps = refs.brandProcesses;
  switch (kind) {
    case "company":
      return bps;
    case "pod":
      return bps.filter((b) => b.brandPodId === value);
    case "brand":
      return bps.filter((b) => b.brandId === value);
    case "process":
      return bps.filter((b) => b.processCode === value);
    case "employee": {
      const mine = new Set(
        refs.assignments.filter((a) => a.employeeId === value).map((a) => a.brandProcessId),
      );
      return bps.filter((b) => mine.has(b.id));
    }
  }
}

/**
 * People the view is about (the rows of the grid): everyone for Company, the pod's members for Pod, and for
 * Brand / Process everyone ASSIGNED (primary or backup) to one of its brand-processes, which is why a backup
 * from another pod shows up on the brand they would cover.
 */
export function visibleEmployees(kind: ViewKind, value: string, refs: Refs) {
  const active = refs.employees.filter((e) => e.isActive);
  switch (kind) {
    case "company":
      return active;
    case "pod":
      return active.filter((e) => e.podId === value);
    case "employee":
      return active.filter((e) => e.id === value);
    case "brand":
    case "process": {
      const bpIds = new Set(visibleBrandProcesses(kind, value, refs).map((b) => b.id));
      const people = new Set(
        refs.assignments.filter((a) => bpIds.has(a.brandProcessId)).map((a) => a.employeeId),
      );
      return active.filter((e) => people.has(e.id));
    }
  }
}

/** Letter code shown in a cell, so status is never conveyed by colour alone. */
export const STATUS_CODE: Record<DraftEntry["status"], string> = {
  WORK: "W",
  WEEKLY_OFF: "O",
  LEAVE: "L",
  COMP_OFF: "C",
  HOLIDAY: "H",
  UNAVAILABLE: "U",
};

export const STATUS_LABEL: Record<DraftEntry["status"], string> = {
  WORK: "Working",
  WEEKLY_OFF: "Weekly off",
  LEAVE: "Leave",
  COMP_OFF: "Comp-off",
  HOLIDAY: "Public holiday",
  UNAVAILABLE: "Unavailable",
};

export const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

export function entryIndex(entries: readonly DraftEntry[]): Map<string, DraftEntry> {
  return new Map(entries.map((e) => [cellKey(e.employeeId, e.date), e]));
}

export interface DayRow {
  employeeId: string;
  name: string;
  podId: string;
  status: DraftEntry["status"];
  /** "Brand / CS" labels the person covers that day (empty unless WORK). */
  covering: string[];
}

export interface DayPanel {
  date: string;
  working: DayRow[];
  /** Working people who cover no brand-process that day: available as backup (the bench, and anyone whose brands are closed). */
  bench: DayRow[];
  off: DayRow[];
  holiday: string | null;
}

/** "Who is working on <date>": grouped from the roster entries, newest overlay included (PDF 3.E). */
export function whoIsWorking(date: string, entries: readonly DraftEntry[], refs: Refs): DayPanel {
  const bpLabel = new Map(
    refs.brandProcesses.map((b) => [b.id, `${b.brandName} / ${b.processCode}`]),
  );
  const byEmp = new Map(refs.employees.map((e) => [e.id, e]));
  const working: DayRow[] = [];
  const bench: DayRow[] = [];
  const off: DayRow[] = [];
  for (const e of entries) {
    if (e.date !== date) continue;
    const emp = byEmp.get(e.employeeId);
    if (!emp || !emp.isActive) continue;
    const row: DayRow = {
      employeeId: emp.id,
      name: emp.name,
      podId: emp.podId,
      status: e.status,
      covering: e.coveredBrandProcessIds.map((id) => bpLabel.get(id) ?? id).sort(),
    };
    if (e.status !== "WORK") off.push(row);
    else if (row.covering.length === 0) bench.push(row);
    else working.push(row);
  }
  const byName = (a: DayRow, b: DayRow) => a.name.localeCompare(b.name);
  return {
    date,
    working: working.sort(byName),
    bench: bench.sort(byName),
    off: off.sort((a, b) => a.status.localeCompare(b.status) || byName(a, b)),
    holiday: refs.holidays.find((h) => h.date === date)?.name ?? null,
  };
}

/** Issues pointing at a person's day, for the marker in the grid. */
export function issuesByCell(issues: readonly Issue[]): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  for (const i of issues) {
    if (!i.employeeId || !i.date) continue;
    const k = cellKey(i.employeeId, i.date);
    out.set(k, [...(out.get(k) ?? []), i]);
  }
  return out;
}

/** Issues pointing at a brand-process on a day (the coverage strip's red cells). */
export function issuesByBpDay(issues: readonly Issue[]): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  for (const i of issues) {
    if (!i.brandProcessId || !i.date) continue;
    const k = cellKey(i.brandProcessId, i.date);
    out.set(k, [...(out.get(k) ?? []), i]);
  }
  return out;
}

/** The highest severity among issues, for colouring a marker. */
export function worstSeverity(issues: readonly Issue[]): Issue["severity"] | null {
  if (issues.some((i) => i.severity === "ERROR")) return "ERROR";
  if (issues.some((i) => i.severity === "WARNING")) return "WARNING";
  return issues.length > 0 ? "INFO" : null;
}

/** Pending leave covering `date` for the employee, shown as a warning chip (it is NOT applied to the roster). */
export function pendingLeaveOn(employeeId: string, date: string, refs: Refs) {
  return refs.leaves.find(
    (l) =>
      l.status === "PENDING" &&
      l.employeeId === employeeId &&
      l.fromDate <= date &&
      date <= l.toDate,
  );
}

/** Where to look for an issue: the cell (person + day) if it names a person, else the coverage row. */
export function issueTarget(
  issue: Issue,
):
  | { kind: "cell"; employeeId: string; date: string }
  | { kind: "strip"; bpId: string; date: string }
  | null {
  if (issue.employeeId && issue.date)
    return { kind: "cell", employeeId: issue.employeeId, date: issue.date };
  if (issue.brandProcessId && issue.date)
    return { kind: "strip", bpId: issue.brandProcessId, date: issue.date };
  return null;
}

export const SEVERITY_ORDER: Issue["severity"][] = ["ERROR", "WARNING", "INFO"];

export function groupBySeverity<T extends { severity: Issue["severity"] }>(issues: readonly T[]) {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    issues: issues.filter((i) => i.severity === severity),
  }));
}

/** "2026-12" -> "December 2026", without ever building a local-time Date. */
export function monthTitle(month: string): string {
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const [y, m] = month.split("-").map(Number);
  return `${names[m - 1]} ${y}`;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
/** Weekday of a YYYY-MM-DD string in UTC (never shifts with the viewer's timezone). */
export function weekdayShort(date: string): (typeof WD)[number] {
  const [y, m, d] = date.split("-").map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** The Monday that starts the Mon-Sun week containing `date`. */
export function mondayOf(date: string): string {
  const offset = (WD.indexOf(weekdayShort(date)) + 6) % 7;
  return addDays(date, -offset);
}

/**
 * The month whose roster OWNS the week containing `date`: the month that holds at least 4 of its 7 days, which
 * is always the month of that week's Thursday (ASSUMPTIONS 18).
 */
export function weekOwnerMonth(date: string): string {
  return addDays(mondayOf(date), 3).slice(0, 7);
}

/** "Mon 28 Dec" */
export function dayLabel(date: string): string {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = date.split("-").map(Number);
  const w = weekdayShort(date);
  return `${w[0]}${w.slice(1).toLowerCase()} ${d} ${MON[m - 1]}`;
}

/** The employee's name for a weekly off that belongs to another month's week, for the edit warning. */
export function carriedOffWarning(
  name: string,
  date: string,
  rosterMonth: string,
): { ownerMonth: string; text: string } | null {
  const owner = weekOwnerMonth(date);
  if (owner === rosterMonth) return null;
  return {
    ownerMonth: owner,
    text: `This is ${name}'s weekly off for ${monthTitle(owner)}'s week of ${dayLabel(mondayOf(date))}. Changing it puts an ERROR on the ${monthTitle(owner)} roster unless they get another off that week.`,
  };
}
