import type { DraftEntry, EntryStatus, Issue, IssueDelta, RosterDraft } from "./types";

/** A roster plus the issues found on it. */
export interface RosterSnapshot {
  draft: RosterDraft;
  issues: Issue[];
}

export interface CellState {
  status: EntryStatus;
  coveredBrandProcessIds: string[];
}

export interface CellChange {
  employeeId: string;
  date: string;
  /** Undefined when the cell did not exist in the earlier roster. */
  before?: CellState;
  after?: CellState;
}

export interface RosterDiff {
  changedCells: CellChange[];
  issueDelta: IssueDelta;
}

const stateOf = (e: DraftEntry | undefined): CellState | undefined =>
  e && { status: e.status, coveredBrandProcessIds: [...e.coveredBrandProcessIds].sort() };

const same = (a: CellState | undefined, b: CellState | undefined) =>
  a?.status === b?.status &&
  (a?.coveredBrandProcessIds ?? []).join("|") === (b?.coveredBrandProcessIds ?? []).join("|");

/**
 * What changed between two rosters: the cells (status or coverage) that differ, and the issues that
 * were added or resolved (matched by their stable ids).
 */
export function diffRosters(a: RosterSnapshot, b: RosterSnapshot): RosterDiff {
  const key = (e: DraftEntry) => `${e.employeeId}|${e.date}`;
  const ea = new Map(a.draft.entries.map((e) => [key(e), e]));
  const eb = new Map(b.draft.entries.map((e) => [key(e), e]));

  const changedCells: CellChange[] = [];
  for (const k of new Set([...ea.keys(), ...eb.keys()])) {
    const before = stateOf(ea.get(k));
    const after = stateOf(eb.get(k));
    if (same(before, after)) continue;
    const ref = (eb.get(k) ?? ea.get(k))!;
    changedCells.push({ employeeId: ref.employeeId, date: ref.date, before, after });
  }
  changedCells.sort(
    (x, y) =>
      (x.employeeId < y.employeeId ? -1 : x.employeeId > y.employeeId ? 1 : 0) ||
      (x.date < y.date ? -1 : x.date > y.date ? 1 : 0),
  );

  const idsA = new Set(a.issues.map((i) => i.id));
  const idsB = new Set(b.issues.map((i) => i.id));
  return {
    changedCells,
    issueDelta: {
      added: b.issues.filter((i) => !idsA.has(i.id)),
      resolved: a.issues.filter((i) => !idsB.has(i.id)),
    },
  };
}
