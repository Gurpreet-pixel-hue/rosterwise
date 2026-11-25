// validateRoster() is THE source of truth: the generator, manual edits, change simulation, suggestion
// pre-checks and the publish gate all call it. There is no second, UI-only check.
//
// Scope: coverage and per-day rules are checked for dates inside the month only. The weekly-off
// requirement for a week the month OWNS (>= 4 days in it) is checked over the whole Mon-Sun week,
// including spill dates and neighbour-month entries.
import { buildCtx, bpLabel, pairKey, requiredOn, type Ctx } from "./ctx";
import { weekdayOf } from "./calendar";
import { issueId } from "./ids";
import { RosterState } from "./state";
import {
  ISSUE_SEVERITY,
  type EngineInput,
  type Issue,
  type IssueCode,
  type RosterDraft,
} from "./types";

interface IssueParts {
  date?: string;
  brandProcessId?: string;
  employeeId?: string;
  relatedIds?: string[];
  groupedIssueIds?: string[];
  message: string;
}

function mk(code: IssueCode, p: IssueParts): Issue {
  const issue: Issue = {
    id: issueId(code, p),
    code,
    severity: ISSUE_SEVERITY[code],
    message: p.message,
    suggestions: [],
  };
  if (p.date !== undefined) issue.date = p.date;
  if (p.brandProcessId !== undefined) issue.brandProcessId = p.brandProcessId;
  if (p.employeeId !== undefined) issue.employeeId = p.employeeId;
  if (p.relatedIds !== undefined) issue.relatedIds = p.relatedIds;
  if (p.groupedIssueIds !== undefined) issue.groupedIssueIds = p.groupedIssueIds;
  return issue;
}

const SEVERITY_RANK = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
const cmp = (a: string | undefined, b: string | undefined) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : 1;

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      cmp(a.date, b.date) ||
      cmp(a.code, b.code) ||
      cmp(a.employeeId, b.employeeId) ||
      cmp(a.brandProcessId, b.brandProcessId),
  );
}

export function validateRoster(input: EngineInput, draft: RosterDraft): Issue[] {
  const ctx = buildCtx(input);
  return validateWith(ctx, RosterState.fromDraft(ctx, draft));
}

export function validateWith(ctx: Ctx, st: RosterState): Issue[] {
  const issues: Issue[] = [];
  const when = (d: string) => `${d} (${weekdayOf(d)})`;
  const nameOf = (id: string) => ctx.empById.get(id)?.name ?? id;

  // ---- NO_ELIGIBLE_STAFF + COVERAGE_GAP ------------------------------------------------------
  const gapIds = new Map<string, Issue>(); // `${bpId}|${date}` -> issue
  for (const bp of ctx.bps) {
    const operatingDates = ctx.monthDates.filter((d) => requiredOn(ctx, bp.id, d) > 0);
    if (operatingDates.length === 0) continue;
    const assignees = ctx.byBp.get(bp.id) ?? [];
    if (assignees.length === 0) {
      issues.push(
        mk("NO_ELIGIBLE_STAFF", {
          brandProcessId: bp.id,
          message: `${bpLabel(bp)} operates on ${operatingDates.length} day(s) of ${ctx.month} (first: ${when(operatingDates[0])}) but has no PRIMARY or BACKUP assignee in the master data.`,
        }),
      );
      continue;
    }
    for (const date of operatingDates) {
      const required = requiredOn(ctx, bp.id, date);
      const covering = st.coverers(date, bp.id).length;
      if (covering >= required) continue;
      const away = assignees
        .filter((a) => !st.coverers(date, bp.id).includes(a.employeeId))
        .map(
          (a) => `${nameOf(a.employeeId)} (${st.cell(a.employeeId, date)?.status ?? "no entry"})`,
        );
      const issue = mk("COVERAGE_GAP", {
        date,
        brandProcessId: bp.id,
        message: `${bpLabel(bp)} on ${when(date)} has ${covering} of ${required} required staff. Not covering: ${away.join(", ")}.`,
      });
      gapIds.set(`${bp.id}|${date}`, issue);
      issues.push(issue);
    }
  }

  // ---- CASCADE_GAP: one person's absence leaves gaps in 2+ brands ----------------------------
  for (const date of ctx.monthDates) {
    for (const emp of ctx.employees) {
      const status = st.cell(emp.id, date)?.status;
      if (status === undefined || status === "WORK") continue;
      const hit = (ctx.byEmp.get(emp.id) ?? [])
        .filter((a) => a.role === "PRIMARY" && gapIds.has(`${a.brandProcessId}|${date}`))
        .map((a) => ctx.bpById.get(a.brandProcessId)!);
      if (new Set(hit.map((b) => b.brandId)).size < 2) continue;
      const bpIds = hit.map((b) => b.id).sort();
      issues.push(
        mk("CASCADE_GAP", {
          date,
          employeeId: emp.id,
          relatedIds: bpIds,
          groupedIssueIds: bpIds.map((id) => gapIds.get(`${id}|${date}`)!.id),
          message: `${emp.name} is ${status} on ${when(date)} and is the PRIMARY for ${hit.length} brand-processes that are now short: ${hit.map(bpLabel).join("; ")}.`,
        }),
      );
    }
  }

  // ---- per-employee, per-day rules -----------------------------------------------------------
  for (const emp of ctx.employees) {
    const fixed = new Set<string>(emp.fixedOffDays);
    for (const date of ctx.monthDates) {
      const cell = st.cell(emp.id, date);
      if (!cell) continue;
      const avail = ctx.avail.get(emp.id)?.get(date);

      if (cell.status === "WORK" && (avail === "LEAVE" || avail === "COMP_OFF")) {
        issues.push(
          mk("WORK_WHILE_UNAVAILABLE", {
            date,
            employeeId: emp.id,
            message: `${emp.name} is scheduled to WORK on ${when(date)} but has approved ${avail === "LEAVE" ? "leave" : "comp-off"} that day.`,
          }),
        );
      }
      if (cell.status === "WORK" && fixed.has(weekdayOf(date))) {
        issues.push(
          mk("FIXED_OFF_VIOLATED", {
            date,
            employeeId: emp.id,
            message: `${emp.name} is scheduled to WORK on ${when(date)}, a contract-fixed off day (${weekdayOf(date)}).`,
          }),
        );
      }
      if (cell.status !== "WORK") continue;

      // shift and allocation, over the brand-processes the employee actually covers
      const covered = [...cell.covered].filter((id) => ctx.pair.has(pairKey(emp.id, id)));
      if (covered.length === 0) continue;
      const load = st.load(emp.id, date);
      const span = st.span(emp.id, date);
      const bps = covered.map((id) => ctx.bpById.get(id)!).sort((a, b) => (a.id < b.id ? -1 : 1));
      const overlapOverAllocated = bps.some((x, i) =>
        bps.slice(i + 1).some((y) => {
          if (x.brandId === y.brandId) return false;
          const [xs, xe] = ctx.shift.get(x.id)!;
          const [ys, ye] = ctx.shift.get(y.id)!;
          const overlaps = xs < ye && ys < xe;
          const pct =
            (ctx.pair.get(pairKey(emp.id, x.id))?.allocationPct ?? 0) +
            (ctx.pair.get(pairKey(emp.id, y.id))?.allocationPct ?? 0);
          return overlaps && pct > 100;
        }),
      );
      const tooLong = span > emp.maxDailyHours * 60;
      if (tooLong || overlapOverAllocated) {
        const detail = bps.map((b) => `${bpLabel(b)} ${b.shiftStart}-${b.shiftEnd}`).join(" and ");
        issues.push(
          mk("SHIFT_INCOMPATIBLE", {
            date,
            employeeId: emp.id,
            relatedIds: bps.map((b) => b.id),
            message: tooLong
              ? `${emp.name} covers ${detail} on ${when(date)}: a ${span / 60}h span exceeds the ${emp.maxDailyHours}h daily maximum.`
              : `${emp.name} covers overlapping shifts for different brands (${detail}) on ${when(date)} with ${load}% allocated.`,
          }),
        );
      } else if (load > 100) {
        issues.push(
          mk("OVERALLOCATED", {
            date,
            employeeId: emp.id,
            relatedIds: bps.map((b) => b.id),
            message: `${emp.name} is allocated ${load}% on ${when(date)} across ${bps.map(bpLabel).join(", ")}.`,
          }),
        );
      }
    }

    // CONSECUTIVE_DAYS_EXCEEDED: once per run, on the day the limit is passed
    let run = 0;
    for (const date of ctx.window) {
      if (st.cell(emp.id, date)?.status === "WORK") {
        run++;
        if (run === emp.maxConsecutiveDays + 1 && ctx.monthSet.has(date)) {
          issues.push(
            mk("CONSECUTIVE_DAYS_EXCEEDED", {
              date,
              employeeId: emp.id,
              message: `${emp.name} works more than ${emp.maxConsecutiveDays} days in a row; the limit is passed on ${when(date)}.`,
            }),
          );
        }
      } else {
        run = 0;
      }
    }
  }

  // ---- WEEKLY_OFF_NOT_GRANTED (weeks the month owns, evaluated over the whole Mon-Sun week) --
  for (const week of ctx.weeks) {
    if (!week.requiresWeeklyOff) continue;
    for (const emp of ctx.employees) {
      if (emp.weeklyOffsPerWeek <= 0) continue;
      const availableInMonth = week.days.filter((d) => {
        const a = ctx.avail.get(emp.id)?.get(d);
        return a !== "LEAVE" && a !== "COMP_OFF";
      });
      if (availableInMonth.length < 4) continue; // too little of the week to require an off
      const w = st.weekOffs(emp.id, week);
      if (w.effective >= emp.weeklyOffsPerWeek) continue;
      const offs = w.plain.length;

      const free = week.fullWeek.filter((d) => {
        const c = st.cell(emp.id, d);
        return c !== undefined && c.status === "WORK" && !c.pinned;
      });
      const lockedWork = week.fullWeek.filter((d) => {
        const c = st.cell(emp.id, d);
        return c !== undefined && c.status === "WORK" && c.pinned;
      });
      const blockers = new Set<string>();
      for (const d of free) {
        for (const s of st.newlyShortIfOff(emp.id, d))
          blockers.add(bpLabel(ctx.bpById.get(s.bpId)!));
      }
      const everyDayNeeded =
        free.length > 0 && free.every((d) => st.newlyShortIfOff(emp.id, d).length > 0);
      let why = "";
      if (everyDayNeeded)
        why += ` Every day they could be off is needed to keep coverage: ${[...blockers].join(", ")}.`;
      if (lockedWork.length > 0) {
        why += ` Locked days that cannot be changed here: ${lockedWork.join(", ")}.`;
      }
      // an off sitting on a public holiday although another day was free does not count
      const holidayNote =
        w.hosted.length > 0 && w.freeDays.length > 0
          ? ` The off was placed on public holiday ${w.hosted
              .map((d) => `${ctx.holidays.get(d)} (${d})`)
              .join(
                ", ",
              )} although ${w.freeDays.join(", ")} ${w.freeDays.length === 1 ? "was" : "were"} free, so the employee loses the holiday.`
          : "";
      issues.push(
        mk("WEEKLY_OFF_NOT_GRANTED", {
          date: week.monday,
          employeeId: emp.id,
          message: `${emp.name} has ${offs} of ${emp.weeklyOffsPerWeek} required weekly off(s) in the week of ${week.monday} to ${week.fullWeek[6]}.${holidayNote}${why}`,
        }),
      );
    }
  }

  // ---- PREFERRED_OFF_NOT_HONOURED: a preferred off day worked because coverage needs them -----
  for (const emp of ctx.employees) {
    if (emp.preferredOffDays.length === 0) continue;
    for (const date of ctx.monthDates) {
      const cell = st.cell(emp.id, date);
      if (!cell || cell.status !== "WORK" || cell.covered.size === 0) continue;
      const wd = weekdayOf(date);
      if (!emp.preferredOffDays.includes(wd)) continue;
      const short = st.newlyShortIfOff(emp.id, date);
      if (short.length === 0) continue;
      issues.push(
        mk("PREFERRED_OFF_NOT_HONOURED", {
          date,
          employeeId: emp.id,
          relatedIds: short.map((s) => s.bpId).sort(),
          message: `${emp.name} prefers ${wd} off but works ${when(date)}: ${short
            .map(
              (s) =>
                `${bpLabel(ctx.bpById.get(s.bpId)!)} needs ${s.required} and nobody else can cover`,
            )
            .join("; ")}. Client coverage takes priority over a preferred day off.`,
        }),
      );
    }
  }

  // ---- PENDING_LEAVE_CONFLICT: pending leave on a day the employee is the sole cover ---------
  for (const l of ctx.input.leaves) {
    if (l.status !== "PENDING") continue;
    const emp = ctx.empById.get(l.employeeId);
    if (!emp || !emp.isActive) continue;
    for (const date of ctx.monthDates) {
      if (date < l.fromDate || date > l.toDate) continue;
      const cell = st.cell(emp.id, date);
      if (!cell || cell.status !== "WORK") continue;
      const short = st.newlyShortIfOff(emp.id, date);
      if (short.length === 0) continue;
      issues.push(
        mk("PENDING_LEAVE_CONFLICT", {
          date,
          employeeId: emp.id,
          relatedIds: short.map((s) => s.bpId).sort(),
          message: `${emp.name} has PENDING leave on ${when(date)} and is the sole cover for ${short
            .map((s) => bpLabel(ctx.bpById.get(s.bpId)!))
            .join("; ")}. Approving it would leave a gap.`,
        }),
      );
    }
  }

  // ---- COMP_OFF_EARNED ------------------------------------------------------------------------
  for (const emp of ctx.employees) {
    for (const date of ctx.monthDates) {
      const name = ctx.holidays.get(date);
      if (name !== undefined && st.cell(emp.id, date)?.status === "WORK") {
        issues.push(
          mk("COMP_OFF_EARNED", {
            date,
            employeeId: emp.id,
            message: `${emp.name} works the public holiday ${name} (${when(date)}) and earns a comp-off credit.`,
          }),
        );
      }
    }
  }

  return sortIssues(issues);
}
