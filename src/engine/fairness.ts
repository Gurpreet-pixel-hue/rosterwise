// Fair weekly-off distribution report (CLAUDE.md P5.3): who works the Sundays and public holidays of a month, and
// how evenly. Pure; counts in-month days only (the same scope as coverage). The spread is computed only over
// people who COULD be asked to work those days (they are assigned to a brand-process that operates on one), so a
// team whose brands are closed on Sundays does not make the numbers look fairer than they are.
import { buildCtx } from "./ctx";
import { isOperating, weekdayOf } from "./calendar";
import type { EngineInput, RosterDraft } from "./types";

export interface FairnessRow {
  employeeId: string;
  name: string;
  podId: string;
  /** Assigned to a brand-process that operates on at least one Sunday (not a holiday) of the month. */
  sundayEligible: boolean;
  /** Assigned to a brand-process that operates on at least one public holiday of the month. */
  holidayEligible: boolean;
  sundaysWorked: number;
  sundaysOff: number;
  holidaysWorked: number;
  /** Public holidays they were given off (status HOLIDAY). */
  holidaysOff: number;
  weeklyOffsOnSunday: number;
  workingDays: number;
  /** Sundays plus public holidays worked: the "premium" days the report compares. */
  premiumDaysWorked: number;
}

export interface Spread {
  min: number;
  max: number;
  /** max - min among eligible people; 0 means perfectly even. */
  difference: number;
  /** People at the max and at the min, for naming them. */
  mostEmployeeIds: string[];
  leastEmployeeIds: string[];
  eligibleCount: number;
}

export interface FairnessReport {
  month: string;
  /** Sundays in the month that are not public holidays (a holiday Sunday is counted as a holiday). */
  sundays: number;
  holidays: number;
  rows: FairnessRow[];
  sundaySpread: Spread;
  holidaySpread: Spread;
  premiumSpread: Spread;
}

function spreadOf(
  rows: FairnessRow[],
  eligible: (r: FairnessRow) => boolean,
  value: (r: FairnessRow) => number,
): Spread {
  const pool = rows.filter(eligible);
  if (pool.length === 0) {
    return {
      min: 0,
      max: 0,
      difference: 0,
      mostEmployeeIds: [],
      leastEmployeeIds: [],
      eligibleCount: 0,
    };
  }
  const vals = pool.map(value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return {
    min,
    max,
    difference: max - min,
    mostEmployeeIds: pool.filter((r) => value(r) === max).map((r) => r.employeeId),
    leastEmployeeIds: pool.filter((r) => value(r) === min).map((r) => r.employeeId),
    eligibleCount: pool.length,
  };
}

export function fairnessReport(input: EngineInput, draft: RosterDraft): FairnessReport {
  const ctx = buildCtx(input);
  const holidaySet = ctx.demandCtx.holidays;
  const sundays = ctx.monthDates.filter((d) => weekdayOf(d) === "SUN" && !holidaySet.has(d));
  const sundayAll = ctx.monthDates.filter((d) => weekdayOf(d) === "SUN");
  const holidays = ctx.monthDates.filter((d) => holidaySet.has(d));
  const bpById = new Map(input.brandProcesses.map((b) => [b.id, b]));

  const byKey = new Map(draft.entries.map((e) => [`${e.employeeId}|${e.date}`, e]));
  const rows: FairnessRow[] = [];
  for (const emp of input.employees) {
    if (!emp.isActive) continue;
    const mine = input.assignments
      .filter((a) => a.employeeId === emp.id)
      .map((a) => bpById.get(a.brandProcessId))
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
    const sundayEligible = mine.some((b) => sundays.some((d) => isOperating(b, d, holidaySet)));
    const holidayEligible = mine.some((b) => holidays.some((d) => isOperating(b, d, holidaySet)));
    let sundaysWorked = 0;
    let sundaysOff = 0;
    let weeklyOffsOnSunday = 0;
    let holidaysWorked = 0;
    let holidaysOff = 0;
    let workingDays = 0;
    for (const d of ctx.monthDates) {
      const e = byKey.get(`${emp.id}|${d}`);
      if (!e) continue;
      if (e.status === "WORK") workingDays++;
      if (holidaySet.has(d)) {
        if (e.status === "WORK") holidaysWorked++;
        else if (e.status === "HOLIDAY") holidaysOff++;
      } else if (sundayAll.includes(d)) {
        if (e.status === "WORK") sundaysWorked++;
        else sundaysOff++;
        if (e.status === "WEEKLY_OFF") weeklyOffsOnSunday++;
      }
    }
    rows.push({
      employeeId: emp.id,
      name: emp.name,
      podId: emp.podId,
      sundayEligible,
      holidayEligible,
      sundaysWorked,
      sundaysOff,
      holidaysWorked,
      holidaysOff,
      weeklyOffsOnSunday,
      workingDays,
      premiumDaysWorked: sundaysWorked + holidaysWorked,
    });
  }
  rows.sort(
    (a, b) =>
      b.premiumDaysWorked - a.premiumDaysWorked ||
      a.name.localeCompare(b.name) ||
      a.employeeId.localeCompare(b.employeeId),
  );
  return {
    month: draft.month,
    sundays: sundays.length,
    holidays: holidays.length,
    rows,
    sundaySpread: spreadOf(
      rows,
      (r) => r.sundayEligible,
      (r) => r.sundaysWorked,
    ),
    holidaySpread: spreadOf(
      rows,
      (r) => r.holidayEligible,
      (r) => r.holidaysWorked,
    ),
    premiumSpread: spreadOf(
      rows,
      (r) => r.sundayEligible || r.holidayEligible,
      (r) => r.premiumDaysWorked,
    ),
  };
}
