import type { OperatingCalendar, Weekday } from "./types";

const WEEKDAYS: readonly Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** A week needs a weekly off only if at least this many of its days fall in the rostered month. */
export const MIN_DAYS_FOR_WEEKLY_OFF = 4;

/** Parse YYYY-MM-DD into a UTC timestamp. Throws on malformed or impossible dates (e.g. 2026-02-30). */
function toUtc(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date "${date}": expected YYYY-MM-DD`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`Invalid date "${date}": no such calendar day`);
  }
  return t;
}

const fromUtc = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Weekday of a YYYY-MM-DD string. UTC arithmetic only, so it never shifts with the local timezone. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(toUtc(date)).getUTCDay()];
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * MS_PER_DAY);
}

/** Inclusive list of dates from `from` to `to`; empty if `from` is after `to`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = toUtc(to);
  for (let t = toUtc(from); t <= end; t += MS_PER_DAY) out.push(fromUtc(t));
  return out;
}

/** Every date in a YYYY-MM month. */
export function monthDates(month: string): string[] {
  const m = MONTH_RE.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new Error(`Invalid month "${month}": expected YYYY-MM`);
  }
  const first = `${month}-01`;
  const next =
    Number(m[2]) === 12
      ? `${Number(m[1]) + 1}-01-01`
      : `${m[1]}-${String(Number(m[2]) + 1).padStart(2, "0")}-01`;
  return datesBetween(first, addDays(next, -1));
}

/**
 * Does a brand-process operate on `date`? This is the brand's operating calendar (DEMAND),
 * independent of any employee's schedule (SUPPLY).
 */
export function isOperating(
  bp: OperatingCalendar,
  date: string,
  holidays: ReadonlySet<string>,
): boolean {
  const isPh = holidays.has(date);
  const weekday = weekdayOf(date);
  switch (bp.operatingRule) {
    case "ALL_DAYS":
      return true;
    case "NO_PUBLIC_HOLIDAYS":
      return !isPh;
    case "NO_SUNDAY_NO_PH":
      return weekday !== "SUN" && !isPh;
    case "CUSTOM":
      return bp.customWeekdays.includes(weekday) && (!isPh || bp.worksOnPublicHolidays);
  }
}

export interface RosterWeek {
  /** The Monday that starts this Mon-Sun week (may be in the previous month). */
  monday: string;
  /** Only this week's days that fall inside the month, in order. */
  days: string[];
  /**
   * All seven Mon-Sun dates, including days in the neighbouring month. The weekly off a month owes
   * for this week may sit on any of them (e.g. Sunday 3 Jan for December's boundary week).
   */
  fullWeek: string[];
  /** True when at least MIN_DAYS_FOR_WEEKLY_OFF of the week's days are in the month. */
  requiresWeeklyOff: boolean;
}

/**
 * Mon-Sun weeks touching a month. A boundary week appears in both neighbouring months, but only
 * the month holding at least MIN_DAYS_FOR_WEEKLY_OFF of its days requires a weekly off for it.
 */
export function weeksOfMonth(month: string): RosterWeek[] {
  const weeks: RosterWeek[] = [];
  for (const date of monthDates(month)) {
    const offset = (WEEKDAYS.indexOf(weekdayOf(date)) + 6) % 7; // days since Monday
    const monday = addDays(date, -offset);
    const last = weeks[weeks.length - 1];
    if (last && last.monday === monday) {
      last.days.push(date);
    } else {
      weeks.push({ monday, days: [date], fullWeek: [], requiresWeeklyOff: false });
    }
  }
  for (const w of weeks) {
    w.fullWeek = Array.from({ length: 7 }, (_, i) => addDays(w.monday, i));
    w.requiresWeeklyOff = w.days.length >= MIN_DAYS_FOR_WEEKLY_OFF;
  }
  return weeks;
}
