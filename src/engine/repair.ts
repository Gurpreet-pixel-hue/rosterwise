// Repair pass for over-long working runs (CONSECUTIVE_DAYS_EXCEEDED).
//
// Weekly offs are placed week by week, so an early off one week followed by a late off the next can
// leave a run of 7+ working days, and one-at-a-time moves get stuck on plateaus (two offs have to
// change together). So for each employee that has a run over their limit, with everyone else held
// fixed, this finds the best choice of off day for EVERY week they own, exactly:
//   1. per owned week, work out which days could host the off without leaving any day worse
//      covered (the current off day is always allowed, so "no change" is always an option);
//   2. enumerate the combinations and keep the one with the least total excess over their limit.
// Ties prefer fewer moved weeks, then preferred weekdays, then earlier dates. A change is applied only
// if it strictly reduces that employee's excess. It never touches a pinned cell, a contract-fixed
// day or a public holiday, and never makes coverage worse. Deterministic: employee id order, bounded.
//
// When one person alone cannot be fixed (three people sharing a minimum of 2 can only be off on
// different days), a second stage swaps the off days of two colleagues in the same week, accepted only
// when their combined excess strictly falls and coverage is no worse.
import { weekdayOf, type RosterWeek } from "./calendar";
import type { Ctx } from "./ctx";
import { defaultCovered, type RosterState } from "./state";
import type { EngineEmployee } from "./types";

const MAX_PASSES = 3;
const MAX_COMBINATIONS = 200_000;

const deficit = (st: RosterState, date: string) =>
  st.shortfalls(date).reduce((n, s) => n + s.required - s.covering, 0);

/** Total working days beyond the limit, over every run of consecutive WORK days in the window. */
function excessOf(window: readonly string[], working: ReadonlySet<string>, limit: number): number {
  let total = 0;
  let run = 0;
  for (const d of window) {
    if (working.has(d)) {
      run++;
      if (run > limit) total++;
    } else {
      run = 0;
    }
  }
  return total;
}

export function repairRuns(ctx: Ctx, st: RosterState): void {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (const emp of ctx.employees) {
      if (repairEmployee(ctx, st, emp)) changed = true;
    }
    for (const emp of ctx.employees) {
      if (swapWithColleague(ctx, st, emp)) changed = true;
    }
    if (!changed) break;
  }
}

const workingSet = (ctx: Ctx, st: RosterState, employeeId: string) =>
  new Set(ctx.window.filter((d) => st.cell(employeeId, d)?.status === "WORK"));

/** The single movable off of an employee in a week, or undefined if there is none or more than one. */
function soleMovableOff(
  ctx: Ctx,
  st: RosterState,
  emp: EngineEmployee,
  week: RosterWeek,
): string | undefined {
  const fixed = new Set<string>(emp.fixedOffDays);
  const offs = week.fullWeek.filter((d) => {
    const c = st.cell(emp.id, d);
    return (
      c !== undefined &&
      c.status === "WEEKLY_OFF" &&
      !c.pinned &&
      !fixed.has(weekdayOf(d)) &&
      !ctx.holidays.has(d)
    );
  });
  return offs.length === 1 ? offs[0] : undefined;
}

/**
 * Swap the off day of `emp` (who has a run over their limit) with a colleague's in the same week, if
 * that strictly lowers their combined excess without making coverage worse on either day.
 */
function swapWithColleague(ctx: Ctx, st: RosterState, emp: EngineEmployee): boolean {
  const limit = (e: EngineEmployee) => e.maxConsecutiveDays;
  const excessNow = (e: EngineEmployee) =>
    excessOf(ctx.window, workingSet(ctx, st, e.id), limit(e));
  if (excessNow(emp) === 0) return false;

  const colleagues = new Set<string>();
  for (const a of ctx.byEmp.get(emp.id) ?? []) {
    for (const b of ctx.byBp.get(a.brandProcessId) ?? [])
      if (b.employeeId !== emp.id) colleagues.add(b.employeeId);
  }

  let best: { other: EngineEmployee; offE: string; offC: string; total: number } | undefined;
  for (const otherId of [...colleagues].sort()) {
    const other = ctx.empById.get(otherId);
    if (!other || !other.isActive) continue;
    for (const week of ctx.weeks) {
      if (!week.requiresWeeklyOff) continue;
      const offE = soleMovableOff(ctx, st, emp, week);
      const offC = soleMovableOff(ctx, st, other, week);
      if (!offE || !offC || offE === offC) continue;
      const cellE = st.cell(emp.id, offC);
      const cellC = st.cell(other.id, offE);
      if (!cellE || !cellC || cellE.status !== "WORK" || cellC.status !== "WORK") continue;
      if (cellE.pinned || cellC.pinned || ctx.holidays.has(offC) || ctx.holidays.has(offE))
        continue;

      const before = excessNow(emp) + excessNow(other);
      const snapA = st.snapshotDate(offE);
      const snapB = st.snapshotDate(offC);
      const deficitBefore = deficit(st, offE) + deficit(st, offC);
      swapOffs(ctx, st, emp.id, other.id, offE, offC);
      const ok = deficit(st, offE) + deficit(st, offC) <= deficitBefore;
      const after = ok ? excessNow(emp) + excessNow(other) : Infinity;
      st.restoreDate(offE, snapA);
      st.restoreDate(offC, snapB);

      if (after < before && (!best || after < best.total))
        best = { other, offE, offC, total: after };
    }
  }
  if (!best) return false;
  swapOffs(ctx, st, emp.id, best.other.id, best.offE, best.offC);
  return true;
}

/** `a` and `b` trade off days: a was off on `da`, b on `db`; afterwards a is off on `db` and b on `da`. */
function swapOffs(ctx: Ctx, st: RosterState, a: string, b: string, da: string, db: string): void {
  const set = (who: string, date: string, status: "WORK" | "WEEKLY_OFF") => {
    const c = st.cell(who, date)!;
    c.status = status;
    c.covered = status === "WORK" ? defaultCovered(ctx, who, date) : new Set();
  };
  set(a, da, "WORK");
  set(a, db, "WEEKLY_OFF");
  set(b, db, "WORK");
  set(b, da, "WEEKLY_OFF");
  st.rebuildDay(da);
  st.rebuildDay(db);
}

interface WeekChoice {
  week: RosterWeek;
  current: string;
  /** Days that can host this week's off (always includes `current`). */
  allowed: string[];
}

function repairEmployee(ctx: Ctx, st: RosterState, emp: EngineEmployee): boolean {
  const workingNow = () => new Set(ctx.window.filter((d) => st.cell(emp.id, d)?.status === "WORK"));
  const before = excessOf(ctx.window, workingNow(), emp.maxConsecutiveDays);
  if (before === 0) return false;

  const fixed = new Set<string>(emp.fixedOffDays);
  const movableOff = (d: string) => {
    const c = st.cell(emp.id, d);
    return (
      c !== undefined &&
      c.status === "WEEKLY_OFF" &&
      !c.pinned &&
      !fixed.has(weekdayOf(d)) &&
      !ctx.holidays.has(d)
    );
  };

  // Weeks with exactly one movable off, and the days that could host it.
  const choices: WeekChoice[] = [];
  for (const week of ctx.weeks) {
    if (!week.requiresWeeklyOff) continue;
    const offs = week.fullWeek.filter(movableOff);
    if (offs.length !== 1) continue;
    const current = offs[0];
    const allowed = [current];
    for (const to of week.fullWeek) {
      if (to === current) continue;
      const target = st.cell(emp.id, to);
      if (!target || target.status !== "WORK" || target.pinned || ctx.holidays.has(to)) continue;
      const snapFrom = st.snapshotDate(current);
      const snapTo = st.snapshotDate(to);
      const worseBefore = deficit(st, current) + deficit(st, to);
      applyMove(ctx, st, emp.id, current, to);
      const ok = deficit(st, current) + deficit(st, to) <= worseBefore;
      st.restoreDate(current, snapFrom);
      st.restoreDate(to, snapTo);
      if (ok) allowed.push(to);
    }
    if (allowed.length > 1) choices.push({ week, current, allowed: allowed.sort() });
  }
  if (choices.length === 0) return false;

  const combos = choices.reduce((n, c) => n * c.allowed.length, 1);
  if (combos > MAX_COMBINATIONS) return false;

  // Enumerate: for each combination, the working set is today's, with each week's off moved.
  const base = workingNow();
  let best: { pick: string[]; excess: number; moved: number; preferred: number } | undefined;
  const pick: string[] = new Array<string>(choices.length);
  const walk = (i: number) => {
    if (i === choices.length) {
      const working = new Set(base);
      let moved = 0;
      let preferred = 0;
      choices.forEach((c, k) => {
        if (pick[k] !== c.current) {
          working.add(c.current);
          working.delete(pick[k]);
          moved++;
        }
        if (emp.preferredOffDays.includes(weekdayOf(pick[k]))) preferred++;
      });
      const excess = excessOf(ctx.window, working, emp.maxConsecutiveDays);
      if (
        !best ||
        excess < best.excess ||
        (excess === best.excess &&
          (moved < best.moved ||
            (moved === best.moved &&
              (preferred > best.preferred ||
                (preferred === best.preferred && pick.join() < best.pick.join())))))
      ) {
        best = { pick: [...pick], excess, moved, preferred };
      }
      return;
    }
    for (const d of choices[i].allowed) {
      pick[i] = d;
      walk(i + 1);
    }
  };
  walk(0);

  if (!best || best.excess >= before) return false;

  // Apply, and make sure the real roster agrees with the prediction and coverage is no worse.
  const dates = [
    ...new Set(
      choices.flatMap((c, k) => (best!.pick[k] !== c.current ? [c.current, best!.pick[k]] : [])),
    ),
  ];
  const snaps = new Map(dates.map((d) => [d, st.snapshotDate(d)]));
  const deficitBefore = dates.reduce((n, d) => n + deficit(st, d), 0);
  choices.forEach((c, k) => {
    if (best!.pick[k] !== c.current) applyMove(ctx, st, emp.id, c.current, best!.pick[k]);
  });
  const deficitAfter = dates.reduce((n, d) => n + deficit(st, d), 0);
  if (
    deficitAfter > deficitBefore ||
    excessOf(ctx.window, workingNow(), emp.maxConsecutiveDays) >= before
  ) {
    for (const [d, snap] of snaps) st.restoreDate(d, snap);
    return false;
  }
  return true;
}

/** Move an employee's weekly off from `from` to `to`, and re-derive backup cover on both days. */
function applyMove(ctx: Ctx, st: RosterState, employeeId: string, from: string, to: string): void {
  const back = st.cell(employeeId, from)!;
  back.status = "WORK";
  back.covered = defaultCovered(ctx, employeeId, from);
  const off = st.cell(employeeId, to)!;
  off.status = "WEEKLY_OFF";
  off.covered = new Set();
  st.rebuildDay(from);
  st.rebuildDay(to);
}
