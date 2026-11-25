// Deterministic, greedy-with-repair roster generation (CLAUDE.md section 4).
//
//  1. expand demand           (ctx.demand)
//  2. expand availability     (ctx.avail; only APPROVED leave/comp-off counts)
//  3. apply locks             (manual locks, history before today, neighbour-month entries, carried offs)
//  4. default everyone to WORK on every available day, covering all PRIMARY brand-processes
//  5. public holidays         (HOLIDAY unless needed; workers earn a comp-off credit)
//  6. weekly offs             (week by week, most-constrained employee first, scored days)
//  7. backup fill             (pull a BACKUP in when a PRIMARY is off or away)
//  8. validate                (the single validateRoster(); the generator reports exactly its issues)
//
// No Math.random, no Date.now: the same input always gives the same roster.
import { analyzeRoster } from "./analyze";
import { addDays, weekdayOf, weeksOfMonth, type RosterWeek } from "./calendar";
import { buildCtx, operatesOn, pairKey, requiredOn, type Ctx } from "./ctx";
import { computeCompOffEarned, defaultCovered, RosterState, type Cell } from "./state";
import type { DraftEntry, EngineEmployee, EngineInput, Issue, RosterDraft } from "./types";
import { validateRoster } from "./validate";

export interface GenerateOptions {
  /** Entries pinned exactly as given (manual edits). Their `locked` flag is preserved. */
  locks?: DraftEntry[];
  /**
   * The previous draft. Entries dated before `input.today` are pinned as history, and a previous
   * weekly-off day is mildly preferred again, so re-planning changes as little as possible.
   */
  previous?: RosterDraft;
  /** Attach ranked, pre-validated suggestions to issues (default true). Turn off for bulk runs. */
  suggestions?: boolean;
}

export interface GenerateResult {
  draft: RosterDraft;
  issues: Issue[];
}

const monthOf = (date: string) => date.slice(0, 7);

export function generateRoster(input: EngineInput, opts: GenerateOptions = {}): GenerateResult {
  const ctx = buildCtx(input);
  const st = new RosterState(ctx);

  initCells(ctx, st, opts);
  applyPublicHolidays(ctx, st);
  for (const d of ctx.window) st.fillDate(d);
  placeWeeklyOffs(ctx, st, opts);
  for (const d of ctx.window) st.fillDate(d);

  const draft = st.toDraft(computeCompOffEarned(ctx, st));
  const issues =
    opts.suggestions === false ? validateRoster(input, draft) : analyzeRoster(input, draft);
  return { draft, issues };
}

// ---------------------------------------------------------------------------------------------
// Steps 3 and 4: locks and defaults
// ---------------------------------------------------------------------------------------------

function pinnedCell(e: DraftEntry): Cell {
  return {
    status: e.status,
    covered: new Set(e.coveredBrandProcessIds),
    locked: e.locked,
    source: e.source,
    note: e.note,
    pinned: true,
  };
}

function initCells(ctx: Ctx, st: RosterState, opts: GenerateOptions): void {
  const key = (e: string, d: string) => `${e}|${d}`;
  const pins = new Map<string, DraftEntry>();

  // History: everything before today, from the previous draft.
  if (ctx.input.today && opts.previous) {
    for (const e of opts.previous.entries)
      if (e.date < ctx.input.today) pins.set(key(e.employeeId, e.date), e);
  }
  // Manual locks win over history.
  for (const e of opts.locks ?? []) pins.set(key(e.employeeId, e.date), e);

  // Neighbour rosters: index their entries once.
  const neighbourEntry = new Map<string, DraftEntry>();
  const neighbourMonths = new Map<string, string>(); // month -> status
  for (const n of ctx.neighbours) {
    neighbourMonths.set(n.month, n.status);
    for (const e of n.entries) neighbourEntry.set(key(e.employeeId, e.date) + "@" + n.month, e);
  }

  // A weekly off the neighbour placed on one of OUR dates, serving a week the neighbour owns.
  const carriedOff = (employeeId: string, date: string) => {
    for (const n of ctx.neighbours) {
      if (n.month === ctx.month) continue;
      const e = neighbourEntry.get(key(employeeId, date) + "@" + n.month);
      if (!e || e.status !== "WEEKLY_OFF") continue;
      const serves = neighbourOwnedWeekContains(n.month, date);
      if (serves) return { entry: e, month: n.month };
    }
    return undefined;
  };

  for (const emp of ctx.employees) {
    for (const date of ctx.window) {
      const pin = pins.get(key(emp.id, date));
      if (pin) {
        st.setCell(emp.id, date, pinnedCell(pin));
        continue;
      }

      // spill date owned by a neighbouring month that has a roster: its entry is a locked input
      if (!ctx.monthSet.has(date)) {
        const n = neighbourEntry.get(key(emp.id, date) + "@" + monthOf(date));
        if (n && neighbourMonths.has(monthOf(date))) {
          st.setCell(emp.id, date, {
            status: n.status,
            covered: new Set(n.coveredBrandProcessIds),
            locked: true,
            source: n.source,
            note: `from ${monthOf(date)} roster`,
            pinned: true,
          });
          continue;
        }
      }

      const avail = ctx.avail.get(emp.id)?.get(date) ?? "AVAILABLE";
      const isHoliday = ctx.holidays.has(date);

      // carried-over weekly off (locked), unless approved leave already covers the day
      if (ctx.monthSet.has(date) && avail !== "LEAVE" && avail !== "COMP_OFF") {
        const carried = carriedOff(emp.id, date);
        if (carried) {
          st.setCell(emp.id, date, {
            status: "WEEKLY_OFF",
            covered: new Set(),
            locked: true,
            source: "AUTO",
            note: `carried from ${carried.month}`,
            pinned: true,
          });
          continue;
        }
      }

      if (avail === "FIXED_OFF") {
        // a contract-fixed off day is a hard constraint and wins even over a public holiday
        st.setCell(emp.id, date, blank("WEEKLY_OFF"));
      } else if (isHoliday && (avail === "LEAVE" || avail === "COMP_OFF")) {
        // a public holiday is not charged against leave
        st.setCell(emp.id, date, blank("HOLIDAY"));
      } else if (avail === "LEAVE") {
        st.setCell(emp.id, date, blank("LEAVE"));
      } else if (avail === "COMP_OFF") {
        st.setCell(emp.id, date, blank("COMP_OFF"));
      } else {
        st.setCell(emp.id, date, {
          status: "WORK",
          covered: defaultCovered(ctx, emp.id, date),
          locked: false,
          source: "AUTO",
          pinned: false,
        });
      }
    }
  }
}

const blank = (status: Cell["status"]): Cell => ({
  status,
  covered: new Set(),
  locked: false,
  source: "AUTO",
  pinned: false,
});

const weeksCache = new Map<string, RosterWeek[]>();
function cachedWeeks(month: string): RosterWeek[] {
  let w = weeksCache.get(month);
  if (!w) {
    w = weeksOfMonth(month);
    weeksCache.set(month, w);
  }
  return w;
}

/** Does the neighbouring month own (>= 4 days of) the Mon-Sun week containing `date`? */
function neighbourOwnedWeekContains(neighbourMonth: string, date: string): boolean {
  return cachedWeeks(neighbourMonth).some((w) => w.requiresWeeklyOff && w.fullWeek.includes(date));
}

// ---------------------------------------------------------------------------------------------
// Step 5: public holidays
// ---------------------------------------------------------------------------------------------

function applyPublicHolidays(ctx: Ctx, st: RosterState): void {
  const worked = new Map<string, number>(); // employee -> public holidays already worked (rotation)

  for (const date of ctx.window) {
    if (!ctx.holidays.has(date)) continue;

    // Everyone free to plan (unpinned WORK) goes to HOLIDAY, then only the people needed come back.
    const pool: string[] = [];
    for (const emp of ctx.employees) {
      const c = st.cell(emp.id, date);
      if (c && c.status === "WORK" && !c.pinned) {
        pool.push(emp.id);
        c.status = "HOLIDAY";
        c.covered = new Set();
      }
    }

    const needy = ctx.bps
      .filter((bp) => requiredOn(ctx, bp.id, date) > 0)
      .map((bp) => ({
        bp,
        candidates: (ctx.byBp.get(bp.id) ?? []).filter((a) => pool.includes(a.employeeId)).length,
      }))
      .sort((a, b) => a.candidates - b.candidates || (a.bp.id < b.bp.id ? -1 : 1));

    for (const { bp } of needy) {
      const required = requiredOn(ctx, bp.id, date);
      while (st.coverers(date, bp.id).length < required) {
        const options = (ctx.byBp.get(bp.id) ?? [])
          .filter(
            (a) => pool.includes(a.employeeId) && !st.coverers(date, bp.id).includes(a.employeeId),
          )
          .filter((a) => promotable(ctx, st, a.employeeId, bp.id, date))
          .sort(
            (x, y) =>
              (x.role === "PRIMARY" ? 0 : 1) - (y.role === "PRIMARY" ? 0 : 1) ||
              (worked.get(x.employeeId) ?? 0) - (worked.get(y.employeeId) ?? 0) ||
              (x.employeeId < y.employeeId ? -1 : 1),
          );
        const pick = options[0];
        if (!pick) break;
        promote(ctx, st, pick.employeeId, bp.id, date);
        worked.set(pick.employeeId, (worked.get(pick.employeeId) ?? 0) + 1);
      }
    }
  }
}

/** What an employee covers once brought back from a public holiday to work `bpId`. */
function coveredOnPromotion(
  ctx: Ctx,
  st: RosterState,
  employeeId: string,
  bpId: string,
  date: string,
): Set<string> {
  return new Set([
    ...defaultCovered(ctx, employeeId, date),
    ...(st.cell(employeeId, date)?.covered ?? []),
    bpId,
  ]);
}

function promotable(
  ctx: Ctx,
  st: RosterState,
  employeeId: string,
  bpId: string,
  date: string,
): boolean {
  const emp = ctx.empById.get(employeeId);
  if (!emp || !st.cell(employeeId, date)) return false;
  // a PRIMARY may always work its own brand-process; a BACKUP must respect load and shift limits
  if (ctx.pair.get(pairKey(employeeId, bpId))?.role === "PRIMARY") return true;
  let load = 0;
  let start = Infinity;
  let end = -Infinity;
  for (const id of coveredOnPromotion(ctx, st, employeeId, bpId, date)) {
    load += ctx.pair.get(pairKey(employeeId, id))?.allocationPct ?? 0;
    const s = ctx.shift.get(id);
    if (s) {
      start = Math.min(start, s[0]);
      end = Math.max(end, s[1]);
    }
  }
  return load <= 100 && end - start <= emp.maxDailyHours * 60;
}

function promote(ctx: Ctx, st: RosterState, employeeId: string, bpId: string, date: string): void {
  const cell = st.cell(employeeId, date)!;
  cell.covered = coveredOnPromotion(ctx, st, employeeId, bpId, date);
  cell.status = "WORK";
}

// ---------------------------------------------------------------------------------------------
// Step 6: weekly offs
// ---------------------------------------------------------------------------------------------

const UNAVAILABLE = (a: string | undefined) => a === "LEAVE" || a === "COMP_OFF";

/** Fewest substitutes across the employee's PRIMARY brand-processes: most constrained first. */
function substitutes(ctx: Ctx, employeeId: string): number {
  let min = Infinity;
  for (const a of ctx.byEmp.get(employeeId) ?? []) {
    if (a.role !== "PRIMARY") continue;
    const others = (ctx.byBp.get(a.brandProcessId) ?? []).filter(
      (x) => x.employeeId !== employeeId,
    ).length;
    min = Math.min(min, others);
  }
  return min;
}

function placeWeeklyOffs(ctx: Ctx, st: RosterState, opts: GenerateOptions): void {
  const order = [...ctx.employees].sort(
    (a, b) => substitutes(ctx, a.id) - substitutes(ctx, b.id) || (a.id < b.id ? -1 : 1),
  );
  const previousOff = new Set(
    (opts.previous?.entries ?? [])
      .filter((e) => e.status === "WEEKLY_OFF")
      .map((e) => `${e.employeeId}|${e.date}`),
  );
  const weekdayCount = new Map<string, number>(); // employee|weekday -> offs granted so far

  for (const week of ctx.weeks) {
    if (!week.requiresWeeklyOff) continue;
    for (const emp of order) {
      if (emp.weeklyOffsPerWeek <= 0) continue;
      // a week with fewer than 4 available in-month days requires no weekly off
      const availableInMonth = week.days.filter(
        (d) => !UNAVAILABLE(ctx.avail.get(emp.id)?.get(d)),
      ).length;
      if (availableInMonth < 4) continue;

      const existing = week.fullWeek.filter(
        (d) => st.cell(emp.id, d)?.status === "WEEKLY_OFF",
      ).length;
      for (let k = existing; k < emp.weeklyOffsPerWeek; k++) {
        const best = chooseOffDay(ctx, st, emp, week.fullWeek, previousOff, weekdayCount);
        // Coverage is client-mandatory: if no day can be given without breaking it, do NOT grant
        // the off. The validator reports WEEKLY_OFF_NOT_GRANTED so a manager decides.
        if (!best || best.score >= 1000) break;
        const cell = st.cell(emp.id, best.date)!;
        cell.status = "WEEKLY_OFF";
        cell.covered = new Set();
        st.fillDate(best.date);
        const wk = `${emp.id}|${weekdayOf(best.date)}`;
        weekdayCount.set(wk, (weekdayCount.get(wk) ?? 0) + 1);
      }
    }
  }
}

function chooseOffDay(
  ctx: Ctx,
  st: RosterState,
  emp: EngineEmployee,
  days: readonly string[],
  previousOff: ReadonlySet<string>,
  weekdayCount: ReadonlyMap<string, number>,
): { date: string; score: number } | undefined {
  const primaryBps = (ctx.byEmp.get(emp.id) ?? [])
    .filter((a) => a.role === "PRIMARY")
    .map((a) => ctx.bpById.get(a.brandProcessId))
    .filter((b): b is NonNullable<typeof b> => b !== undefined);

  let best: { date: string; score: number } | undefined;
  for (const date of days) {
    const cell = st.cell(emp.id, date);
    if (!cell || cell.pinned || (cell.status !== "WORK" && cell.status !== "HOLIDAY")) continue;

    // +1000 per brand-process that would fall below `required` even after backups are tried
    const impact =
      cell.status === "WORK"
        ? st.newlyShortIfOff(emp.id, date).reduce((n, x) => n + x.deficit, 0)
        : 0;
    let score = impact * 1000;
    // 0 when none of the employee's brand-processes operate (a day that is free by definition)
    const operating = primaryBps.some((bp) => operatesOn(ctx, bp, date));
    score += operating ? 1 : 0;
    if (emp.preferredOffDays.includes(weekdayOf(date))) score -= 5;
    // Rotate the good day (Sunday) instead of handing the same person the same one every week. Only
    // when it costs the brand something: a Sunday on which nothing operates is free for everyone.
    if (operating && weekdayOf(date) === "SUN") {
      score += 3 * (weekdayCount.get(`${emp.id}|SUN`) ?? 0);
    }
    // a public holiday is a day off already: prefer a different day, but it stays usable
    if (cell.status === "HOLIDAY") score += 4;
    // spill dates are provisional, so prefer in-month days when otherwise equal
    if (!ctx.monthSet.has(date)) score += 2;
    if (previousOff.has(`${emp.id}|${date}`)) score -= 20;
    // spread offs: avoid days when colleagues who share a brand-process are already away
    score += 2 * crowd(ctx, st, emp.id, date);
    score += consecutivePenalty(ctx, st, emp, date);

    if (!best || score < best.score) best = { date, score };
  }
  return best;
}

/** How many colleagues sharing a brand-process with `employeeId` are not working on `date`. */
function crowd(ctx: Ctx, st: RosterState, employeeId: string, date: string): number {
  const mates = new Set<string>();
  for (const a of ctx.byEmp.get(employeeId) ?? []) {
    for (const b of ctx.byBp.get(a.brandProcessId) ?? [])
      if (b.employeeId !== employeeId) mates.add(b.employeeId);
  }
  let away = 0;
  for (const id of mates) {
    const status = st.cell(id, date)?.status;
    if (status !== undefined && status !== "WORK") away++;
  }
  return away;
}

/**
 * How far past the employee's limit the working run BEFORE `date` already is: +10 per extra day.
 * Looking backwards only, because later weeks are not planned yet. It makes the off come earlier in
 * the week when the run is long, rather than flatly penalising every day.
 */
function consecutivePenalty(ctx: Ctx, st: RosterState, emp: EngineEmployee, date: string): number {
  const inWindow = new Set(ctx.window);
  let run = 0;
  let d = addDays(date, -1);
  while (inWindow.has(d) && st.cell(emp.id, d)?.status === "WORK") {
    run++;
    d = addDays(d, -1);
  }
  return Math.max(0, run - emp.maxConsecutiveDays) * 10;
}
