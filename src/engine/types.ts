// Engine types. Plain TypeScript only: the engine has no DB, Next.js or I/O imports.
// Dates are `YYYY-MM-DD` strings and months are `YYYY-MM`; the engine never creates a `Date` for
// a calendar day outside the UTC-only helpers in calendar.ts.

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

// ---------------------------------------------------------------------------------------------
// Engine input
// ---------------------------------------------------------------------------------------------

export type AssignmentRole = "PRIMARY" | "BACKUP";
export type LeaveType = "PLANNED" | "SICK" | "COMP_OFF";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";
export type EntryStatus = "WORK" | "WEEKLY_OFF" | "LEAVE" | "COMP_OFF" | "HOLIDAY" | "UNAVAILABLE";
export type EntrySource = "AUTO" | "MANUAL";

export interface EngineEmployee {
  id: string;
  name: string;
  podId: string;
  isActive: boolean;
  weeklyOffsPerWeek: number;
  /** Contract-fixed off days: a HARD constraint. */
  fixedOffDays: readonly Weekday[];
  /** Preferred off days: a SOFT preference. */
  preferredOffDays: readonly Weekday[];
  maxConsecutiveDays: number;
  maxDailyHours: number;
}

export interface EngineBrandProcess extends BrandProcessDemandInput {
  brandId: string;
  brandName: string;
  /** The brand's owning pod. */
  brandPodId: string;
  processCode: string;
  /** HH:mm, same-day shift. */
  shiftStart: string;
  shiftEnd: string;
}

export interface EngineAssignment {
  employeeId: string;
  brandProcessId: string;
  role: AssignmentRole;
  allocationPct: number;
}

export interface EngineLeave {
  id: string;
  employeeId: string;
  fromDate: string;
  toDate: string;
  type: LeaveType;
  status: LeaveStatus;
}

export interface EngineHoliday {
  date: string;
  name: string;
}

/** One cell of a roster: exactly one per (employee, date). */
export interface DraftEntry {
  employeeId: string;
  date: string;
  status: EntryStatus;
  /** BrandProcess ids this employee covers that day (primary work and backup cover). */
  coveredBrandProcessIds: string[];
  locked: boolean;
  source: EntrySource;
  /** Free text, e.g. "carried from 2026-12". Not persisted as a column; P3 writes it to the audit log. */
  note?: string;
}

export interface CompOffEarned {
  employeeId: string;
  earnedOn: string;
  reason: string;
}

/**
 * The roster for month M covers every date of every Mon-Sun week touching M (the planning window).
 * Entries dated outside M are SPILL entries: provisional unless the neighbouring month's roster
 * supplies them.
 */
export interface RosterDraft {
  month: string;
  entries: DraftEntry[];
  compOffEarned: CompOffEarned[];
}

/** A neighbouring month's roster (latest version, any status), used as locked context. */
export interface NeighbourRoster {
  month: string;
  status: "DRAFT" | "PUBLISHED";
  entries: DraftEntry[];
}

export interface EngineInput {
  /** The month being rostered, YYYY-MM. */
  month: string;
  /** Dates before `today` are treated as history when re-planning. YYYY-MM-DD. */
  today?: string;
  employees: EngineEmployee[];
  brandProcesses: EngineBrandProcess[];
  assignments: EngineAssignment[];
  holidays: EngineHoliday[];
  leaves: EngineLeave[];
  coverageOverrides: CoverageOverrideInput[];
  neighbourRosters?: NeighbourRoster[];
}

// ---------------------------------------------------------------------------------------------
// Issues and suggestions
// ---------------------------------------------------------------------------------------------

export type Severity = "ERROR" | "WARNING" | "INFO";

export type IssueCode =
  | "COVERAGE_GAP"
  | "NO_ELIGIBLE_STAFF"
  | "WORK_WHILE_UNAVAILABLE"
  | "WEEKLY_OFF_NOT_GRANTED"
  | "FIXED_OFF_VIOLATED"
  | "SHIFT_INCOMPATIBLE"
  | "OVERALLOCATED"
  | "CASCADE_GAP"
  | "PREFERRED_OFF_NOT_HONOURED"
  | "CONSECUTIVE_DAYS_EXCEEDED"
  | "PENDING_LEAVE_CONFLICT"
  | "COMP_OFF_EARNED";

export const ISSUE_SEVERITY: Record<IssueCode, Severity> = {
  COVERAGE_GAP: "ERROR",
  NO_ELIGIBLE_STAFF: "ERROR",
  WORK_WHILE_UNAVAILABLE: "ERROR",
  WEEKLY_OFF_NOT_GRANTED: "ERROR",
  FIXED_OFF_VIOLATED: "ERROR",
  SHIFT_INCOMPATIBLE: "ERROR",
  OVERALLOCATED: "WARNING",
  CASCADE_GAP: "ERROR",
  PREFERRED_OFF_NOT_HONOURED: "WARNING",
  CONSECUTIVE_DAYS_EXCEEDED: "WARNING",
  PENDING_LEAVE_CONFLICT: "WARNING",
  COMP_OFF_EARNED: "INFO",
};

export type SuggestionType = "USE_BACKUP" | "SWAP_OFF_DAY" | "REASSIGN_FROM_POD" | "ACCEPT_GAP";

/** A change to one cell. Applying a suggestion means applying its edits (and any temporary assignment). */
export interface EntryEdit {
  employeeId: string;
  date: string;
  status: EntryStatus;
  coveredBrandProcessIds: string[];
}

export interface Suggestion {
  type: SuggestionType;
  description: string;
  employeeId?: string;
  brandProcessId?: string;
  date?: string;
  fromDate?: string;
  toDate?: string;
  edits: EntryEdit[];
  /** REASSIGN_FROM_POD needs manager-approved temporary assignments (one per brand-process covered). */
  temporaryAssignments?: EngineAssignment[];
  /** Warnings this suggestion would add (suggestions never add an ERROR). */
  newWarnings: number;
}

export interface Issue {
  /** Stable hash of code + entity + date, so issue diffs work across versions. */
  id: string;
  code: IssueCode;
  severity: Severity;
  date?: string;
  brandProcessId?: string;
  employeeId?: string;
  relatedIds?: string[];
  /** For CASCADE_GAP: the COVERAGE_GAP issue ids it groups. */
  groupedIssueIds?: string[];
  message: string;
  suggestions: Suggestion[];
}

// ---------------------------------------------------------------------------------------------
// Change handling
// ---------------------------------------------------------------------------------------------

export type EngineChange =
  | { type: "ADD_LEAVE"; leave: EngineLeave }
  | { type: "REMOVE_LEAVE"; leaveId: string }
  | { type: "MAKE_UNAVAILABLE"; employeeId: string; fromDate: string; toDate: string }
  | {
      type: "CHANGE_RULE";
      brandProcessId: string;
      patch: Partial<
        Pick<
          EngineBrandProcess,
          "operatingRule" | "customWeekdays" | "worksOnPublicHolidays" | "shiftStart" | "shiftEnd"
        >
      >;
    }
  | {
      type: "CHANGE_MIN_STAFF";
      brandProcessId: string;
      defaultMinStaff?: number;
      weekdayMinStaff?: Partial<Record<Weekday, number>> | null;
      override?: { date: string; minStaff: number };
    };

export interface IssueDelta {
  added: Issue[];
  resolved: Issue[];
}
