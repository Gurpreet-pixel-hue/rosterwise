// Engine types. Plain TypeScript only: the engine has no DB, Next.js or I/O imports.
// Dates are `YYYY-MM-DD` strings and months are `YYYY-MM`; the engine never creates a `Date` for
// a calendar day outside a UTC-only helper in calendar.ts.
//
// The rest of the engine types (EngineInput, RosterDraft, Issue, Suggestion) arrive in P2.

export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export type OperatingRule = "ALL_DAYS" | "NO_PUBLIC_HOLIDAYS" | "NO_SUNDAY_NO_PH" | "CUSTOM";

/** The part of a brand-process that decides which days it operates. */
export interface OperatingCalendar {
  operatingRule: OperatingRule;
  /** Only read when operatingRule is CUSTOM. */
  customWeekdays: readonly Weekday[];
  /** Only read when operatingRule is CUSTOM. */
  worksOnPublicHolidays: boolean;
}

/** The part of a brand-process that decides how many people it needs. */
export interface BrandProcessDemandInput extends OperatingCalendar {
  id: string;
  defaultMinStaff: number;
  weekdayMinStaff: Partial<Record<Weekday, number>> | null;
}

export interface CoverageOverrideInput {
  brandProcessId: string;
  date: string;
  minStaff: number;
}
