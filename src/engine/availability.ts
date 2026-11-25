import type { EngineEmployee, EngineLeave, Weekday } from "./types";
import { weekdayOf } from "./calendar";

/**
 * What the master data says about an employee on a date, before any rostering decision.
 * Only APPROVED leave counts; PENDING and REJECTED never make anyone unavailable.
 */
export type Availability = "AVAILABLE" | "LEAVE" | "COMP_OFF" | "FIXED_OFF";

export function availabilityOf(
  employee: Pick<EngineEmployee, "id" | "fixedOffDays">,
  date: string,
  leaves: readonly EngineLeave[],
): Availability {
  let onLeave = false;
  for (const l of leaves) {
    if (l.employeeId !== employee.id || l.status !== "APPROVED") continue;
    if (l.fromDate <= date && date <= l.toDate) {
      if (l.type === "COMP_OFF") return "COMP_OFF";
      onLeave = true;
    }
  }
  if (onLeave) return "LEAVE";
  return employee.fixedOffDays.includes(weekdayOf(date) as Weekday) ? "FIXED_OFF" : "AVAILABLE";
}

/** Availability for every employee on every date: Map<employeeId, Map<date, Availability>>. */
export function buildAvailability(
  employees: readonly EngineEmployee[],
  leaves: readonly EngineLeave[],
  dates: readonly string[],
): Map<string, Map<string, Availability>> {
  const out = new Map<string, Map<string, Availability>>();
  for (const e of employees) {
    out.set(e.id, new Map(dates.map((d) => [d, availabilityOf(e, d, leaves)])));
  }
  return out;
}
