// An INDEPENDENT oracle for roster correctness. It deliberately imports nothing from state.ts, ctx.ts,
// validate.ts or generate.ts: it recomputes coverage and weekly offs from the raw draft entries, the
// raw assignments and the demand rules (requiredStaff), so a bug in the engine's own coverage maths
// cannot hide from it.
import { monthDates, weeksOfMonth } from "../calendar";
import { indexOverrides, requiredStaff } from "../demand";
import type { EngineInput, RosterDraft } from "../types";

export interface Shortfall {
  bpId: string;
  date: string;
  covering: number;
  required: number;
  /** True when nobody at all is assigned to the brand-process. */
  noAssignees: boolean;
}

const holidaySet = (input: EngineInput) => new Set(input.holidays.map((h) => h.date));

/** Per (brand-process, in-month date): how many assigned employees are WORKing and covering it. */
export function coverageShortfalls(input: EngineInput, draft: RosterDraft): Shortfall[] {
  const ctx = { holidays: holidaySet(input), overrides: indexOverrides(input.coverageOverrides) };
  const out: Shortfall[] = [];
  for (const bp of input.brandProcesses) {
    const assigned = new Set(
      input.assignments.filter((a) => a.brandProcessId === bp.id).map((a) => a.employeeId),
    );
    for (const date of monthDates(input.month)) {
      const required = requiredStaff(bp, date, ctx);
      if (required === 0) continue;
      const covering = draft.entries.filter(
        (e) =>
          e.date === date &&
          e.status === "WORK" &&
          e.coveredBrandProcessIds.includes(bp.id) &&
          assigned.has(e.employeeId),
      ).length;
      if (covering < required)
        out.push({ bpId: bp.id, date, covering, required, noAssignees: assigned.size === 0 });
    }
  }
  return out;
}

/**
 * Does the employee have another, non-holiday day that week which is working, unlocked, and whose
 * brand-processes are all already covered by other people (no backup fill is assumed, so this is
 * stricter than the engine's own notion of "free")?
 */
export function hasPlainFreeDay(
  input: EngineInput,
  draft: RosterDraft,
  employeeId: string,
  fullWeek: string[],
): boolean {
  const ctx = { holidays: holidaySet(input), overrides: indexOverrides(input.coverageOverrides) };
  return fullWeek.some((t) => {
    if (ctx.holidays.has(t)) return false;
    const mine = draft.entries.find((e) => e.employeeId === employeeId && e.date === t);
    if (!mine || mine.status !== "WORK" || mine.locked) return false;
    return mine.coveredBrandProcessIds.every((bpId) => {
      const bp = input.brandProcesses.find((b) => b.id === bpId)!;
      const assigned = new Set(
        input.assignments.filter((a) => a.brandProcessId === bpId).map((a) => a.employeeId),
      );
      const others = draft.entries.filter(
        (e) =>
          e.date === t &&
          e.employeeId !== employeeId &&
          e.status === "WORK" &&
          e.coveredBrandProcessIds.includes(bpId) &&
          assigned.has(e.employeeId),
      ).length;
      return others >= requiredStaff(bp, t, ctx);
    });
  });
}

/** `${employeeId}|${mondayOfWeek}` for every owned week in which an employee lacks a valid weekly off. */
export function missingWeeklyOffs(input: EngineInput, draft: RosterDraft): Set<string> {
  const holidays = holidaySet(input);
  const missing = new Set<string>();
  for (const week of weeksOfMonth(input.month).filter((w) => w.requiresWeeklyOff)) {
    for (const emp of input.employees.filter((e) => e.isActive)) {
      if (emp.weeklyOffsPerWeek <= 0) continue;
      const onLeave = (d: string) =>
        input.leaves.some(
          (l) =>
            l.employeeId === emp.id && l.status === "APPROVED" && l.fromDate <= d && d <= l.toDate,
        );
      if (week.days.filter((d) => !onLeave(d)).length < 4) continue;
      const offs = draft.entries
        .filter(
          (e) =>
            e.employeeId === emp.id && e.status === "WEEKLY_OFF" && week.fullWeek.includes(e.date),
        )
        .map((e) => e.date);
      const plain = offs.filter((d) => !holidays.has(d)).length;
      const hosted = offs.length - plain;
      // an off on a public holiday counts only if no other day of the week could have hosted it
      const counted =
        plain + (hosted > 0 && !hasPlainFreeDay(input, draft, emp.id, week.fullWeek) ? hosted : 0);
      if (counted < emp.weeklyOffsPerWeek) missing.add(`${emp.id}|${week.monday}`);
    }
  }
  return missing;
}
