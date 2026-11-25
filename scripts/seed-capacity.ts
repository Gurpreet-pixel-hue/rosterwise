// Static feasibility of the seed, built on the engine's own calendar.ts and demand.ts so the seed
// check and the engine can never disagree about which days a brand operates or how many it needs.
//
// These are NECESSARY conditions, not proof that a roster exists: they ignore that other people also
// need weekly offs and have other duties. A failure here means no scheduler could succeed.
import { monthDates, weekdayOf, weeksOfMonth } from "../src/engine/calendar";
import { indexOverrides, requiredStaff, type DemandContext } from "../src/engine/demand";
import type { EmployeeRow, SeedSnapshot } from "../prisma/seed-data";

/** Months the demo covers, and the months the static checks look at. */
export const CHECKED_MONTHS = ["2026-12", "2027-01"] as const;

/** Brands that are deliberately unschedulable (demo Scenario 2). Reported as EXPECTED, not failures. */
export const EXPECTED_INFEASIBLE: readonly string[] = ["Nimbus Gadgets"];

export type InfeasibilityKind = "CAPACITY" | "WEEKLY_OFF";

export interface Infeasibility {
  kind: InfeasibilityKind;
  brand: string;
  message: string;
}

export function findInfeasibilities(s: SeedSnapshot): Infeasibility[] {
  const out: Infeasibility[] = [];
  const rangeStart = monthDates(CHECKED_MONTHS[0])[0];
  const rangeEnd = monthDates(CHECKED_MONTHS[CHECKED_MONTHS.length - 1]).at(-1)!;
  const holidays = new Set(s.holidays.map((h) => h.date));
  const ctx: DemandContext = { holidays, overrides: indexOverrides(s.coverageOverrides) };
  const brandName = new Map(s.brands.map((b) => [b.id, b.name]));
  const procCode = new Map(s.processes.map((p) => [p.id, p.code]));
  const empById = new Map(s.employees.map((e) => [e.id, e]));
  const label = (bpId: string) => {
    const bp = s.brandProcesses.find((x) => x.id === bpId)!;
    return `${brandName.get(bp.brandId)} / ${procCode.get(bp.processId)}`;
  };

  // Approved leave and approved comp-off make an employee unavailable. PENDING/REJECTED do not.
  const onLeave = (empId: string, date: string) =>
    s.leaves.some(
      (l) =>
        l.employeeId === empId && l.status === "APPROVED" && l.fromDate <= date && date <= l.toDate,
    );
  const isAvailable = (e: EmployeeRow, date: string) => e.isActive && !onLeave(e.id, date);
  const availableToWork = (e: EmployeeRow, date: string) =>
    isAvailable(e, date) && !e.fixedOffDays.includes(weekdayOf(date));

  const assigneesOf = new Map<string, EmployeeRow[]>();
  for (const a of s.assignments) {
    const e = empById.get(a.employeeId);
    if (!e) continue;
    const list = assigneesOf.get(a.brandProcessId) ?? [];
    if (!list.includes(e)) list.push(e);
    assigneesOf.set(a.brandProcessId, list);
  }

  // 1. CAPACITY: on every operating day, enough assignees (PRIMARY + BACKUP) must be available.
  for (const bp of s.brandProcesses) {
    const short: string[] = [];
    for (const month of CHECKED_MONTHS) {
      for (const week of weeksOfMonth(month)) {
        for (const date of week.days) {
          const required = requiredStaff(bp, date, ctx);
          if (required === 0) continue;
          const ceiling = (assigneesOf.get(bp.id) ?? []).filter((e) =>
            availableToWork(e, date),
          ).length;
          if (ceiling < required) short.push(`${date} has at most ${ceiling} of ${required}`);
        }
      }
    }
    if (short.length > 0) {
      out.push({
        kind: "CAPACITY",
        brand: brandName.get(bp.brandId)!,
        message: `${label(bp.id)}: ${short.join(", ")}`,
      });
    }
  }

  // 2. WEEKLY_OFF: in every qualifying week, each employee with PRIMARY duties needs at least one
  //    day on which they are not needed (every PRIMARY brand-process that day is covered by others).
  for (const e of s.employees) {
    const primaryBps = s.assignments
      .filter((a) => a.employeeId === e.id && a.role === "PRIMARY")
      .map((a) => s.brandProcesses.find((bp) => bp.id === a.brandProcessId)!)
      .filter(Boolean);
    if (primaryBps.length === 0) continue;

    const blockedWeeks = new Map<string, string[]>(); // brand -> weeks (Mondays)
    for (const month of CHECKED_MONTHS) {
      for (const week of weeksOfMonth(month)) {
        if (!week.requiresWeeklyOff) continue;
        const inMonthFree = week.days.filter((d) => isAvailable(e, d));
        // Leave and public holidays do not replace the weekly off, but a week with fewer than 4
        // available in-month days requires none.
        if (inMonthFree.length < 4) continue;
        // The off may sit on any day of the Mon-Sun week, including neighbouring-month days (the
        // boundary-week ruling), as long as that day is inside the range this seed describes.
        const free = week.fullWeek.filter(
          (d) => d >= rangeStart && d <= rangeEnd && isAvailable(e, d),
        );
        const fixed = free.filter((d) => e.fixedOffDays.includes(weekdayOf(d)));
        const candidates = fixed.length > 0 ? fixed : free;

        const blockingBrandsPerDay = candidates.map((date) => {
          const brands = new Set<string>();
          for (const bp of primaryBps) {
            const required = requiredStaff(bp, date, ctx);
            if (required === 0) continue;
            const others = (assigneesOf.get(bp.id) ?? []).filter(
              (o) => o.id !== e.id && availableToWork(o, date),
            ).length;
            if (others < required) brands.add(brandName.get(bp.brandId)!);
          }
          return brands;
        });
        if (blockingBrandsPerDay.every((b) => b.size > 0)) {
          // Blame the brands that block on every candidate day, else every brand involved.
          const common = [...blockingBrandsPerDay[0]].filter((b) =>
            blockingBrandsPerDay.every((set) => set.has(b)),
          );
          const blamed =
            common.length > 0 ? common : [...new Set(blockingBrandsPerDay.flatMap((x) => [...x]))];
          for (const b of blamed)
            blockedWeeks.set(b, [...(blockedWeeks.get(b) ?? []), week.monday]);
        }
      }
    }
    for (const [brand, weeks] of blockedWeeks) {
      out.push({
        kind: "WEEKLY_OFF",
        brand,
        message: `${e.name} cannot be given a weekly off in ${weeks.length} week(s) (${brand} needs them every candidate day): weeks of ${weeks.join(", ")}`,
      });
    }
  }
  return out;
}
