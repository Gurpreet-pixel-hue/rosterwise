// What each CSV export contains (CLAUDE.md P5.2). Pure: the route handler loads the data, this builds the rows,
// so the same view rules (roster-view.ts) decide who and what is exported as decide what is on screen.
import type { CoverageTable } from "@/engine/coverage";
import type { DraftEntry, Issue } from "@/engine/types";
import type { RosterRefs } from "@/server/pageData";
import {
  STATUS_CODE,
  STATUS_LABEL,
  VIEW_KINDS,
  cellKey,
  entryIndex,
  type ViewKind,
  visibleBrandProcesses,
  visibleEmployees,
  weekdayShort,
} from "./roster-view";
import { toCsv } from "./csv";

export const EXPORT_WHAT = ["grid", "coverage", "issues"] as const;
export type ExportWhat = (typeof EXPORT_WHAT)[number];

export const isViewKind = (v: string): v is ViewKind =>
  (VIEW_KINDS as readonly string[]).includes(v);
export const isExportWhat = (v: string): v is ExportWhat =>
  (EXPORT_WHAT as readonly string[]).includes(v);

const header = (dates: string[]) => dates.map((d) => `${d} ${weekdayShort(d)}`);

/** One row per person, one column per day of the planning window: the status letter, and what they cover. */
export function gridRows(args: {
  kind: ViewKind;
  value: string;
  window: string[];
  entries: DraftEntry[];
  refs: RosterRefs;
}): string[][] {
  const { kind, value, window, entries, refs } = args;
  const byKey = entryIndex(entries);
  const pods = new Map(refs.pods.map((p) => [p.id, p.name]));
  const bps = new Map(refs.brandProcesses.map((b) => [b.id, `${b.brandName} / ${b.processCode}`]));
  const rows: string[][] = [["Employee", "Pod", ...header(window)]];
  for (const e of visibleEmployees(kind, value, refs)) {
    rows.push([
      e.name,
      pods.get(e.podId) ?? "",
      ...window.map((d) => {
        const c = byKey.get(cellKey(e.id, d));
        if (!c) return "";
        const cover = c.coveredBrandProcessIds
          .map((id) => bps.get(id) ?? id)
          .sort()
          .join("; ");
        return cover ? `${STATUS_CODE[c.status]} (${cover})` : STATUS_CODE[c.status];
      }),
    ]);
  }
  return rows;
}

/** One row per brand-process, one column per day of the month: "covering/required", or "-" when not operating. */
export function coverageRows(args: {
  kind: ViewKind;
  value: string;
  monthDates: string[];
  coverage: CoverageTable;
  refs: RosterRefs;
}): string[][] {
  const { kind, value, monthDates, coverage, refs } = args;
  const rows: string[][] = [["Brand", "Process", "Shift", ...header(monthDates)]];
  for (const b of visibleBrandProcesses(kind, value, refs)) {
    rows.push([
      b.brandName,
      b.processCode,
      `${b.shiftStart}-${b.shiftEnd}`,
      ...monthDates.map((d) => {
        const c = coverage[b.id]?.[d];
        if (!c || c.required === 0) return "-";
        return `${c.covering}/${c.required}`;
      }),
    ]);
  }
  return rows;
}

export function issueRows(args: {
  issues: Array<Issue & { acknowledgement?: { note: string; actor: string } | null }>;
  refs: RosterRefs;
  kindFilter?: { employeeIds: ReadonlySet<string>; bpIds: ReadonlySet<string> };
}): string[][] {
  const { issues, refs, kindFilter } = args;
  const emp = new Map(refs.employees.map((e) => [e.id, e.name]));
  const bps = new Map(refs.brandProcesses.map((b) => [b.id, `${b.brandName} / ${b.processCode}`]));
  const rows: string[][] = [
    [
      "Severity",
      "Code",
      "Date",
      "Employee",
      "Brand / process",
      "Message",
      "Acknowledged",
      "Acknowledgement note",
    ],
  ];
  for (const i of issues) {
    if (
      kindFilter &&
      !(
        (i.employeeId !== undefined && kindFilter.employeeIds.has(i.employeeId)) ||
        (i.brandProcessId !== undefined && kindFilter.bpIds.has(i.brandProcessId)) ||
        (i.employeeId === undefined && i.brandProcessId === undefined)
      )
    )
      continue;
    rows.push([
      i.severity,
      i.code,
      i.date ?? "",
      i.employeeId ? (emp.get(i.employeeId) ?? i.employeeId) : "",
      i.brandProcessId ? (bps.get(i.brandProcessId) ?? i.brandProcessId) : "",
      i.message,
      i.acknowledgement ? "yes" : "",
      i.acknowledgement?.note ?? "",
    ]);
  }
  return rows;
}

export const csvFor = (rows: string[][]) => toCsv(rows);

/** A safe download file name such as roster-2026-12-brand-nimbus-gadgets-grid.csv */
export function exportFileName(
  month: string,
  kind: ViewKind,
  label: string,
  what: ExportWhat,
): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const parts = ["roster", month, kind, kind === "company" ? "" : slug(label), what].filter(
    Boolean,
  );
  return `${parts.join("-")}.csv`;
}

export const STATUS_LEGEND = Object.entries(STATUS_LABEL)
  .map(([k, v]) => `${STATUS_CODE[k as DraftEntry["status"]]} = ${v}`)
  .join(", ");
