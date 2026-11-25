// Mutable working state of a roster, shared by the generator, the validator and the suggestion
// engine so they all agree on what "covered", "load" and "needed" mean. Internal to the engine.
import { operatesOn, pairKey, requiredOn, type Ctx } from "./ctx";
import type {
  CompOffEarned,
  DraftEntry,
  EngineBrandProcess,
  EntrySource,
  EntryStatus,
  RosterDraft,
} from "./types";

export interface Cell {
  status: EntryStatus;
  covered: Set<string>;
  locked: boolean;
  source: EntrySource;
  note?: string;
  /** Pinned cells are never changed by planning or backup fill (manual locks, history, neighbour data). */
  pinned: boolean;
}

export interface Shortfall {
  bpId: string;
  date: string;
  covering: number;
  required: number;
}

const cloneCell = (c: Cell): Cell => ({ ...c, covered: new Set(c.covered) });

/** What a working employee covers by default: every PRIMARY brand-process that operates that day. */
export function defaultCovered(ctx: Ctx, employeeId: string, date: string): Set<string> {
  const covered = new Set<string>();
  for (const a of ctx.byEmp.get(employeeId) ?? []) {
    if (a.role !== "PRIMARY") continue;
    const bp = ctx.bpById.get(a.brandProcessId);
    if (bp && operatesOn(ctx, bp, date)) covered.add(bp.id);
  }
  return covered;
}

export class RosterState {
  private byDate = new Map<string, Map<string, Cell>>();

  constructor(readonly ctx: Ctx) {}

  cell(employeeId: string, date: string): Cell | undefined {
    return this.byDate.get(date)?.get(employeeId);
  }

  setCell(employeeId: string, date: string, cell: Cell): void {
    let day = this.byDate.get(date);
    if (!day) {
      day = new Map();
      this.byDate.set(date, day);
    }
    day.set(employeeId, cell);
  }

  // ---- coverage ----------------------------------------------------------------------------

  /** Employees who are assigned to the brand-process, WORKing that date, and covering it. */
  coverers(date: string, bpId: string): string[] {
    const out: string[] = [];
    for (const a of this.ctx.byBp.get(bpId) ?? []) {
      const c = this.cell(a.employeeId, date);
      if (c && c.status === "WORK" && c.covered.has(bpId)) out.push(a.employeeId);
    }
    return out;
  }

  /** Brand-processes that need more people than are covering them on `date`. */
  shortfalls(date: string): Shortfall[] {
    const out: Shortfall[] = [];
    for (const bp of this.ctx.bps) {
      const required = requiredOn(this.ctx, bp.id, date);
      if (required === 0) continue;
      const covering = this.coverers(date, bp.id).length;
      if (covering < required) out.push({ bpId: bp.id, date, covering, required });
    }
    return out;
  }

  /** What the employee covers on `date`; a public-holiday employee who would be called in covers their defaults. */
  private coveredFor(employeeId: string, date: string, extraBp?: string): Set<string> {
    const c = this.cell(employeeId, date);
    const base =
      c && c.status === "HOLIDAY"
        ? defaultCovered(this.ctx, employeeId, date)
        : new Set(c ? c.covered : []);
    if (extraBp) base.add(extraBp);
    return base;
  }

  /** Sum of allocation percentages over what the employee covers that day. */
  load(employeeId: string, date: string, extraBp?: string): number {
    let sum = 0;
    for (const bpId of this.coveredFor(employeeId, date, extraBp)) {
      sum += this.ctx.pair.get(pairKey(employeeId, bpId))?.allocationPct ?? 0;
    }
    return sum;
  }

  /** Earliest start to latest end across the covered brand-processes, in minutes. */
  span(employeeId: string, date: string, extraBp?: string): number {
    let start = Infinity;
    let end = -Infinity;
    for (const bpId of this.coveredFor(employeeId, date, extraBp)) {
      const sh = this.ctx.shift.get(bpId);
      if (!sh) continue;
      start = Math.min(start, sh[0]);
      end = Math.max(end, sh[1]);
    }
    return end === -Infinity ? 0 : end - start;
  }

  /**
   * Can this employee take on `bp` today without breaking load (<= 100%) or the shift limit? They must
   * be working, or on a public holiday without approved leave (then they would be called in and earn
   * a comp-off, which is why such candidates rank last).
   */
  canAddCover(employeeId: string, bp: EngineBrandProcess, date: string): boolean {
    const c = this.cell(employeeId, date);
    if (!c || c.pinned || c.covered.has(bp.id)) return false;
    if (c.status !== "WORK") {
      const calledIn =
        c.status === "HOLIDAY" &&
        !["LEAVE", "COMP_OFF"].includes(this.ctx.avail.get(employeeId)?.get(date) ?? "");
      if (!calledIn) return false;
    }
    if (!this.ctx.pair.has(pairKey(employeeId, bp.id))) return false;
    const emp = this.ctx.empById.get(employeeId);
    if (!emp) return false;
    if (this.load(employeeId, date, bp.id) > 100) return false;
    return this.span(employeeId, date, bp.id) <= emp.maxDailyHours * 60;
  }

  /**
   * Backup fill: for every brand-process short on `date`, add the best working assignee.
   * Preference: PRIMARY assignees first, then same pod as the brand, then lowest load, then id.
   * Returns what is still short afterwards.
   */
  fillDate(date: string): Shortfall[] {
    const candidatesFor = (bp: EngineBrandProcess) =>
      (this.ctx.byBp.get(bp.id) ?? [])
        .filter((a) => this.canAddCover(a.employeeId, bp, date))
        .sort(
          (x, y) =>
            this.rank(x.employeeId, x.role, bp, date) - this.rank(y.employeeId, y.role, bp, date) ||
            (x.employeeId < y.employeeId ? -1 : 1),
        );

    const short = this.shortfalls(date);
    // most constrained first: fewest candidates, then id
    const order = short
      .map((s) => ({
        s,
        bp: this.ctx.bpById.get(s.bpId)!,
        n: candidatesFor(this.ctx.bpById.get(s.bpId)!).length,
      }))
      .sort((a, b) => a.n - b.n || (a.bp.id < b.bp.id ? -1 : 1));

    for (const { bp } of order) {
      const required = requiredOn(this.ctx, bp.id, date);
      while (this.coverers(date, bp.id).length < required) {
        const best = candidatesFor(bp)[0];
        if (!best) break;
        const cell = this.cell(best.employeeId, date)!;
        if (cell.status === "HOLIDAY") {
          cell.status = "WORK";
          cell.covered = defaultCovered(this.ctx, best.employeeId, date);
        }
        cell.covered.add(bp.id);
      }
    }
    return this.shortfalls(date);
  }

  private rank(
    employeeId: string,
    role: "PRIMARY" | "BACKUP",
    bp: EngineBrandProcess,
    date: string,
  ): number {
    const emp = this.ctx.empById.get(employeeId)!;
    return (
      (role === "PRIMARY" ? 0 : 1_000_000) +
      (emp.podId === bp.brandPodId ? 0 : 100_000) +
      this.load(employeeId, date)
    );
  }

  // ---- what-if -------------------------------------------------------------------------------

  snapshotDate(date: string): Map<string, Cell> {
    const day = this.byDate.get(date);
    return new Map([...(day ?? [])].map(([id, c]) => [id, cloneCell(c)]));
  }

  restoreDate(date: string, snap: Map<string, Cell>): void {
    this.byDate.set(date, new Map([...snap].map(([id, c]) => [id, cloneCell(c)])));
  }

  /** Run `fn` against the date, then put the date back exactly as it was. */
  private trial<T>(date: string, fn: () => T): T {
    const snap = this.snapshotDate(date);
    try {
      return fn();
    } finally {
      this.restoreDate(date, snap);
    }
  }

  /** Brand-processes still short after backup fill, with the date left untouched. */
  shortAfterFill(date: string): Shortfall[] {
    return this.trial(date, () => this.fillDate(date));
  }

  /**
   * Brand-processes whose headcount deficit would GROW if `employeeId` stopped working `date`, even
   * after backups are pulled in. `deficit` is how many more people are missing (so a day that is
   * already 1 short and becomes 2 short counts, not just one that newly breaks). Empty means someone
   * else can cover everything this person covers.
   */
  newlyShortIfOff(employeeId: string, date: string): Array<Shortfall & { deficit: number }> {
    const deficitOf = (list: Shortfall[]) =>
      new Map(list.map((s) => [s.bpId, s.required - s.covering]));
    const before = deficitOf(this.shortAfterFill(date));
    const after = this.trial(date, () => {
      const c = this.cell(employeeId, date);
      if (!c || c.status !== "WORK") return [];
      c.status = "WEEKLY_OFF";
      c.covered = new Set();
      return this.fillDate(date);
    });
    return after
      .map((s) => ({ ...s, deficit: s.required - s.covering - (before.get(s.bpId) ?? 0) }))
      .filter((s) => s.deficit > 0);
  }

  // ---- conversion ----------------------------------------------------------------------------

  static fromDraft(ctx: Ctx, draft: RosterDraft): RosterState {
    const st = new RosterState(ctx);
    for (const e of draft.entries) {
      st.setCell(e.employeeId, e.date, {
        status: e.status,
        covered: new Set(e.coveredBrandProcessIds),
        locked: e.locked,
        source: e.source,
        note: e.note,
        pinned: e.locked,
      });
    }
    return st;
  }

  toDraft(compOffEarned: CompOffEarned[]): RosterDraft {
    const entries: DraftEntry[] = [];
    for (const emp of this.ctx.employees) {
      for (const date of this.ctx.window) {
        const c = this.cell(emp.id, date);
        if (!c) continue;
        const entry: DraftEntry = {
          employeeId: emp.id,
          date,
          status: c.status,
          coveredBrandProcessIds: c.status === "WORK" ? [...c.covered].sort() : [],
          locked: c.locked,
          source: c.source,
        };
        if (c.note) entry.note = c.note;
        entries.push(entry);
      }
    }
    return { month: this.ctx.month, entries, compOffEarned };
  }
}

/** Comp-off credits: a credit is earned by working a public holiday that falls inside the month. */
export function computeCompOffEarned(ctx: Ctx, st: RosterState): CompOffEarned[] {
  const out: CompOffEarned[] = [];
  for (const emp of ctx.employees) {
    for (const date of ctx.monthDates) {
      const name = ctx.holidays.get(date);
      if (name === undefined) continue;
      if (st.cell(emp.id, date)?.status === "WORK") {
        out.push({ employeeId: emp.id, earnedOn: date, reason: `Worked public holiday: ${name}` });
      }
    }
  }
  return out;
}
