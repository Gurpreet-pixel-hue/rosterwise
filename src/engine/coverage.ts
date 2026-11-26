// Coverage table: for every brand-process and every in-month date, how many people are required and how many
// are covering. Built from the SAME RosterState and requiredOn() the validator uses, so the coverage strip
// in the UI cannot disagree with COVERAGE_GAP (tested: a cell is short exactly when a gap issue exists).
import { buildCtx } from "./ctx";
import { RosterState } from "./state";
import type { EngineInput, RosterDraft } from "./types";

export interface CoverageCell {
  /** Required staff that day; 0 when the brand-process does not operate (a grey cell). */
  required: number;
  covering: number;
  /** Who is covering, so the UI can show names without recomputing. */
  coverers: string[];
}

/** brandProcessId -> date (in the month only) -> cell. */
export type CoverageTable = Record<string, Record<string, CoverageCell>>;

export function coverageTable(input: EngineInput, draft: RosterDraft): CoverageTable {
  const ctx = buildCtx(input);
  const st = RosterState.fromDraft(ctx, draft);
  const out: CoverageTable = {};
  for (const bp of ctx.bps) {
    const row: Record<string, CoverageCell> = {};
    for (const date of ctx.monthDates) {
      const required = ctx.demand.get(bp.id)?.get(date) ?? 0;
      const coverers = st.coverers(date, bp.id);
      row[date] = { required, covering: coverers.length, coverers };
    }
    out[bp.id] = row;
  }
  return out;
}
