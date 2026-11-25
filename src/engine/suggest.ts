// Suggestions: ranked, pre-validated ways to resolve an issue (CLAUDE.md section 4).
//
// Every suggestion carries concrete cell edits. Before it is returned it is applied to a copy of the
// roster and run through validateRoster(): a suggestion that would introduce a NEW ERROR is dropped,
// and one that does not actually resolve its target issue is dropped too. Ranking: fewest new
// warnings, then same pod, then lowest load, then id.
import { buildCtx, bpLabel, operatesOn, pairKey, type Ctx } from "./ctx";
import { applyEdits } from "./edit";
import { weekdayOf } from "./calendar";
import { RosterState } from "./state";
import type {
  DraftEntry,
  EngineAssignment,
  EngineInput,
  EntryEdit,
  Issue,
  RosterDraft,
  Suggestion,
  SuggestionType,
} from "./types";
import { validateRoster } from "./validate";

const MAX_PER_TYPE = 2;

export function applySuggestion(
  input: EngineInput,
  draft: RosterDraft,
  s: Suggestion,
): { input: EngineInput; draft: RosterDraft } {
  return {
    input: s.temporaryAssignments?.length
      ? { ...input, assignments: [...input.assignments, ...s.temporaryAssignments] }
      : input,
    draft: applyEdits(draft, s.edits, { locked: true, source: "MANUAL" }),
  };
}

interface Candidate {
  suggestion: Omit<Suggestion, "newWarnings">;
  samePod: boolean;
  load: number;
}

const acceptGap = (issue: Issue): Suggestion => ({
  type: "ACCEPT_GAP",
  description:
    "Accept this as it stands: acknowledge the issue with a note so the roster can still be published.",
  employeeId: issue.employeeId,
  brandProcessId: issue.brandProcessId,
  date: issue.date,
  edits: [],
  newWarnings: 0,
});

class Suggester {
  readonly ctx: Ctx;
  private readonly st: RosterState;
  private readonly baselineErrors: Set<string>;
  private readonly baselineWarnings: Set<string>;

  constructor(
    readonly input: EngineInput,
    readonly draft: RosterDraft,
    baseline: readonly Issue[],
  ) {
    this.ctx = buildCtx(input);
    this.st = RosterState.fromDraft(this.ctx, draft);
    this.baselineErrors = new Set(baseline.filter((i) => i.severity === "ERROR").map((i) => i.id));
    this.baselineWarnings = new Set(
      baseline.filter((i) => i.severity === "WARNING").map((i) => i.id),
    );
  }

  /** Validate a candidate; return it as a Suggestion, or undefined if it is not acceptable. */
  private check(
    c: Candidate,
    target: Issue,
    mustResolve: boolean,
  ): { s: Suggestion; c: Candidate } | undefined {
    const { input, draft } = applySuggestion(this.input, this.draft, {
      ...c.suggestion,
      newWarnings: 0,
    });
    const after = validateRoster(input, draft);
    if (after.some((i) => i.severity === "ERROR" && !this.baselineErrors.has(i.id)))
      return undefined;
    if (mustResolve && after.some((i) => i.id === target.id)) return undefined;
    const newWarnings = after.filter(
      (i) => i.severity === "WARNING" && !this.baselineWarnings.has(i.id),
    ).length;
    return { s: { ...c.suggestion, newWarnings }, c };
  }

  private pick(candidates: Candidate[], target: Issue, mustResolve: boolean): Suggestion[] {
    const perType = new Map<SuggestionType, number>();
    const valid: Array<{ s: Suggestion; c: Candidate }> = [];
    for (const c of candidates) {
      if ((perType.get(c.suggestion.type) ?? 0) >= MAX_PER_TYPE * 3) continue; // bound validation work
      const r = this.check(c, target, mustResolve);
      perType.set(c.suggestion.type, (perType.get(c.suggestion.type) ?? 0) + 1);
      if (r) valid.push(r);
    }
    valid.sort(
      (a, b) =>
        a.s.newWarnings - b.s.newWarnings ||
        Number(!a.c.samePod) - Number(!b.c.samePod) ||
        a.c.load - b.c.load ||
        ((a.s.employeeId ?? "") < (b.s.employeeId ?? "") ? -1 : 1),
    );
    const kept = new Map<SuggestionType, number>();
    const out: Suggestion[] = [];
    for (const v of valid) {
      const n = kept.get(v.s.type) ?? 0;
      if (n >= MAX_PER_TYPE) continue;
      kept.set(v.s.type, n + 1);
      out.push(v.s);
    }
    return out;
  }

  /** Extra edits caused by running backup fill on `dates` after a change (so the suggestion is complete). */
  private fillEdits(afterChange: RosterDraft, dates: string[]): EntryEdit[] {
    const st = RosterState.fromDraft(this.ctx, afterChange);
    for (const d of dates) st.fillDate(d);
    const filled = st.toDraft([]);
    const before = new Map(afterChange.entries.map((e) => [`${e.employeeId}|${e.date}`, e]));
    const edits: EntryEdit[] = [];
    for (const e of filled.entries) {
      if (!dates.includes(e.date)) continue;
      const b = before.get(`${e.employeeId}|${e.date}`);
      if (b && b.status === e.status && sameSet(b.coveredBrandProcessIds, e.coveredBrandProcessIds))
        continue;
      edits.push({
        employeeId: e.employeeId,
        date: e.date,
        status: e.status,
        coveredBrandProcessIds: e.coveredBrandProcessIds,
      });
    }
    return edits;
  }

  private entry(employeeId: string, date: string): DraftEntry | undefined {
    return this.draft.entries.find((e) => e.employeeId === employeeId && e.date === date);
  }

  private defaultCovered(employeeId: string, date: string, extra: string): string[] {
    const out = new Set<string>([extra]);
    for (const a of this.ctx.byEmp.get(employeeId) ?? []) {
      if (a.role !== "PRIMARY") continue;
      const bp = this.ctx.bpById.get(a.brandProcessId);
      if (bp && operatesOn(this.ctx, bp, date)) out.add(bp.id);
    }
    return [...out].sort();
  }

  private weekOf(date: string): string[] {
    return this.ctx.weeks.find((w) => w.fullWeek.includes(date))?.fullWeek ?? [date];
  }

  // ---- COVERAGE_GAP --------------------------------------------------------------------------

  forCoverageGap(issue: Issue): Suggestion[] {
    const date = issue.date!;
    const bp = this.ctx.bpById.get(issue.brandProcessId!)!;
    const label = bpLabel(bp);
    const nameOf = (id: string) => this.ctx.empById.get(id)?.name ?? id;
    const candidates: Candidate[] = [];
    const assignees = this.ctx.byBp.get(bp.id) ?? [];

    for (const a of assignees) {
      const cell = this.entry(a.employeeId, date);
      if (!cell) continue;
      const emp = this.ctx.empById.get(a.employeeId)!;
      const samePod = emp.podId === bp.brandPodId;
      const load = this.st.load(a.employeeId, date);

      // USE_BACKUP: an assignee who is working that day but not covering this brand-process
      if (cell.status === "WORK" && !cell.coveredBrandProcessIds.includes(bp.id)) {
        candidates.push({
          samePod,
          load,
          suggestion: {
            type: "USE_BACKUP",
            description: `Use ${a.role === "BACKUP" ? "backup" : "primary"} ${nameOf(a.employeeId)} (already working, ${load}% allocated) to cover ${label} on ${date}.`,
            employeeId: a.employeeId,
            brandProcessId: bp.id,
            date,
            edits: [
              {
                employeeId: a.employeeId,
                date,
                status: "WORK",
                coveredBrandProcessIds: [...cell.coveredBrandProcessIds, bp.id].sort(),
              },
            ],
          },
        });
      }

      // SWAP_OFF_DAY: an assignee whose weekly off is today moves it to another day of the week
      // (a locked off is a deliberate decision, so a suggestion never proposes undoing it)
      if (cell.status === "WEEKLY_OFF" && !cell.locked) {
        for (const t of this.weekOf(date)) {
          if (t === date) continue;
          const other = this.entry(a.employeeId, t);
          if (!other || other.status !== "WORK") continue;
          const swap: EntryEdit[] = [
            {
              employeeId: a.employeeId,
              date,
              status: "WORK",
              coveredBrandProcessIds: this.defaultCovered(a.employeeId, date, bp.id),
            },
            { employeeId: a.employeeId, date: t, status: "WEEKLY_OFF", coveredBrandProcessIds: [] },
          ];
          const extra = this.fillEdits(
            applyEdits(this.draft, swap, { locked: true, source: "MANUAL" }),
            [t],
          );
          candidates.push({
            samePod,
            load,
            suggestion: {
              type: "SWAP_OFF_DAY",
              description: `Move ${nameOf(a.employeeId)}'s weekly off from ${date} to ${t} so they can cover ${label} on ${date}.`,
              employeeId: a.employeeId,
              brandProcessId: bp.id,
              date,
              fromDate: date,
              toDate: t,
              edits: [...swap, ...extra],
            },
          });
        }
      }
    }

    candidates.push(...this.reassignCandidates(bp.id, date, bp.brandPodId));
    return [...this.pick(candidates, issue, true), acceptGap(issue)];
  }

  /**
   * REASSIGN_FROM_POD: someone in the brand's pod who is working, has spare load, and is not yet
   * assigned to the brand-process, covering it under a manager-approved temporary assignment.
   */
  private reassignCandidates(bpId: string, date: string, podId: string): Candidate[] {
    const bp = this.ctx.bpById.get(bpId)!;
    const out: Candidate[] = [];
    const pods = this.ctx.employees
      .filter((e) => e.podId === podId && !this.ctx.pair.has(pairKey(e.id, bpId)))
      .map((e) => ({ e, load: this.st.load(e.id, date) }))
      .filter(({ e }) => this.st.cell(e.id, date)?.status === "WORK")
      .sort((a, b) => a.load - b.load || (a.e.id < b.e.id ? -1 : 1))
      .slice(0, 3);
    for (const { e, load } of pods) {
      const spare = 100 - load;
      if (spare <= 0) continue;
      const pct = Math.min(
        spare,
        Math.max(
          10,
          this.ctx.byBp.get(bpId)?.find((a) => a.role === "PRIMARY")?.allocationPct ?? 50,
        ),
      );
      const cell = this.entry(e.id, date)!;
      const temp: EngineAssignment = {
        employeeId: e.id,
        brandProcessId: bpId,
        role: "BACKUP",
        allocationPct: pct,
      };
      out.push({
        samePod: true,
        load,
        suggestion: {
          type: "REASSIGN_FROM_POD",
          description: `Ask ${e.name} (same pod, working, ${load}% allocated) to cover ${bpLabel(bp)} on ${date} under a manager-approved temporary assignment (${pct}%).`,
          employeeId: e.id,
          brandProcessId: bpId,
          date,
          edits: [
            {
              employeeId: e.id,
              date,
              status: "WORK",
              coveredBrandProcessIds: [...cell.coveredBrandProcessIds, bpId].sort(),
            },
          ],
          temporaryAssignments: [temp],
        },
      });
    }
    return out;
  }

  // ---- WEEKLY_OFF_NOT_GRANTED ------------------------------------------------------------------

  forWeeklyOff(issue: Issue): Suggestion[] {
    const employeeId = issue.employeeId!;
    const emp = this.ctx.empById.get(employeeId)!;
    const week = this.ctx.weeks.find((w) => w.monday === issue.date);
    if (!week) return [acceptGap(issue)];
    const candidates: Candidate[] = [];
    const primaryBps = (this.ctx.byEmp.get(employeeId) ?? [])
      .filter((a) => a.role === "PRIMARY")
      .map((a) => this.ctx.bpById.get(a.brandProcessId)!);

    for (const t of week.fullWeek) {
      const cell = this.entry(employeeId, t);
      if (!cell || cell.status !== "WORK") continue;
      const offEdit: EntryEdit = {
        employeeId,
        date: t,
        status: "WEEKLY_OFF",
        coveredBrandProcessIds: [],
      };
      const afterOff = applyEdits(this.draft, [offEdit], { locked: true, source: "MANUAL" });
      const extra = this.fillEdits(afterOff, [t]);
      // The validator only checks coverage inside the month, so a suggestion on a spill date must not
      // quietly leave that date short: that would just move the gap into the neighbouring roster.
      if (!this.ctx.monthSet.has(t)) {
        const after = RosterState.fromDraft(
          this.ctx,
          applyEdits(afterOff, extra, { locked: true, source: "MANUAL" }),
        );
        const deficit = (st: RosterState) =>
          st.shortfalls(t).reduce((n, x) => n + x.required - x.covering, 0);
        if (deficit(after) > deficit(this.st)) continue;
      }
      const spill = !this.ctx.monthSet.has(t);
      const lockedNote = cell.locked
        ? ` (it is locked${spill ? ` in the ${t.slice(0, 7)} roster` : ""}, so change it there too)`
        : "";
      candidates.push({
        samePod: true,
        load: 0,
        suggestion: {
          type: "SWAP_OFF_DAY",
          description:
            extra.length > 0
              ? `Give ${emp.name} the weekly off on ${t}${lockedNote} and let ${extra.map((e) => this.ctx.empById.get(e.employeeId)?.name ?? e.employeeId).join(", ")} cover.`
              : `Give ${emp.name} the weekly off on ${t}${lockedNote}; coverage still holds.`,
          employeeId,
          date: t,
          toDate: t,
          edits: [offEdit, ...extra],
        },
      });

      // REASSIGN_FROM_POD: a pod-mate covers what would be short that day (one assignment per brand-process)
      const short = this.st.newlyShortIfOff(employeeId, t);
      if (short.length > 0 && primaryBps.length > 0) {
        const podId = this.ctx.bpById.get(short[0].bpId)!.brandPodId;
        const mates = this.ctx.employees
          .filter(
            (e) =>
              e.podId === podId && e.id !== employeeId && this.st.cell(e.id, t)?.status === "WORK",
          )
          .filter((e) => short.every((s) => !this.ctx.pair.has(pairKey(e.id, s.bpId))))
          .map((e) => ({ e, load: this.st.load(e.id, t) }))
          .sort((a, b) => a.load - b.load || (a.e.id < b.e.id ? -1 : 1))
          .slice(0, 2);
        for (const { e, load } of mates) {
          const temps: EngineAssignment[] = short.map((s) => ({
            employeeId: e.id,
            brandProcessId: s.bpId,
            role: "BACKUP",
            allocationPct: this.ctx.pair.get(pairKey(employeeId, s.bpId))?.allocationPct ?? 50,
          }));
          if (load + temps.reduce((n, a) => n + a.allocationPct, 0) > 100) continue;
          const mateCell = this.entry(e.id, t)!;
          candidates.push({
            samePod: true,
            load,
            suggestion: {
              type: "REASSIGN_FROM_POD",
              description: `Give ${emp.name} the weekly off on ${t} and ask ${e.name} (same pod, ${load}% allocated) to cover ${short.map((s) => bpLabel(this.ctx.bpById.get(s.bpId)!)).join(" and ")} under a manager-approved temporary assignment.`,
              employeeId: e.id,
              date: t,
              edits: [
                offEdit,
                {
                  employeeId: e.id,
                  date: t,
                  status: "WORK",
                  coveredBrandProcessIds: [
                    ...new Set([...mateCell.coveredBrandProcessIds, ...short.map((s) => s.bpId)]),
                  ].sort(),
                },
              ],
              temporaryAssignments: temps,
            },
          });
        }
      }
    }
    // earliest day first keeps the order stable; preferred weekdays first is friendlier
    candidates.sort(
      (a, b) =>
        Number(emp.preferredOffDays.includes(weekdayOf(b.suggestion.date!))) -
          Number(emp.preferredOffDays.includes(weekdayOf(a.suggestion.date!))) ||
        (a.suggestion.date! < b.suggestion.date! ? -1 : 1),
    );
    return [...this.pick(candidates, issue, true), acceptGap(issue)];
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

/** Suggestions for one issue of a roster. */
export function suggestionsFor(issue: Issue, input: EngineInput, draft: RosterDraft): Suggestion[] {
  const baseline = validateRoster(input, draft);
  const s = new Suggester(input, draft, baseline);
  switch (issue.code) {
    case "COVERAGE_GAP":
      return s.forCoverageGap(issue);
    case "WEEKLY_OFF_NOT_GRANTED":
      return s.forWeeklyOff(issue);
    case "CASCADE_GAP": {
      const byId = new Map(baseline.map((i) => [i.id, i]));
      return cascadeSuggestions(issue, (id) => s.forCoverageGap(byId.get(id)!));
    }
    default:
      return issue.severity === "ERROR" ? [acceptGap(issue)] : [];
  }
}

function cascadeSuggestions(issue: Issue, forGap: (id: string) => Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const id of issue.groupedIssueIds ?? []) {
    for (const s of forGap(id)) {
      if (s.type === "ACCEPT_GAP") continue;
      const key = `${s.type}|${s.employeeId}|${s.date}|${s.brandProcessId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return [...out.slice(0, 4), acceptGap(issue)];
}

/** Attach suggestions to every issue that can use them. `issues` must be validateRoster()'s output. */
export function attachSuggestions(
  input: EngineInput,
  draft: RosterDraft,
  issues: Issue[],
): Issue[] {
  const s = new Suggester(input, draft, issues);
  const computed = new Map<string, Suggestion[]>();
  const forGap = (gap: Issue): Suggestion[] => {
    let r = computed.get(gap.id);
    if (!r) {
      r = s.forCoverageGap(gap);
      computed.set(gap.id, r);
    }
    return r;
  };
  const byId = new Map(issues.map((i) => [i.id, i]));
  return issues.map((issue) => {
    switch (issue.code) {
      case "COVERAGE_GAP":
        return { ...issue, suggestions: forGap(issue) };
      case "WEEKLY_OFF_NOT_GRANTED":
        return { ...issue, suggestions: s.forWeeklyOff(issue) };
      case "CASCADE_GAP":
        return { ...issue, suggestions: cascadeSuggestions(issue, (id) => forGap(byId.get(id)!)) };
      default:
        return issue.severity === "ERROR" ? { ...issue, suggestions: [acceptGap(issue)] } : issue;
    }
  });
}

// DraftEntry is re-exported for callers building suggestions by hand.
export type { DraftEntry };
