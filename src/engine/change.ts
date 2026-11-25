// Change handling (assessment section F): preview what a change does to an existing roster WITHOUT
// saving anything, re-planning only the weeks it touches.
import { analyzeRoster } from "./analyze";
import { datesBetween, weeksOfMonth } from "./calendar";
import { diffRosters, type CellChange, type RosterSnapshot } from "./diff";
import { generateRoster } from "./generate";
import type {
  DraftEntry,
  EngineChange,
  EngineInput,
  Issue,
  IssueDelta,
  RosterDraft,
  Suggestion,
} from "./types";
import { validateRoster } from "./validate";

export interface SimulationResult {
  newInput: EngineInput;
  newDraft: RosterDraft;
  newIssues: Issue[];
  changedCells: CellChange[];
  issueDelta: IssueDelta;
  /** Suggestions for the issues this change ADDED. */
  suggestions: Suggestion[];
  /** Mondays of the weeks that were re-planned; every other week is untouched. */
  replannedWeeks: string[];
}

/** The input after the change. Adding a leave with an existing id replaces it (approving a pending leave). */
export function applyChange(input: EngineInput, change: EngineChange): EngineInput {
  switch (change.type) {
    case "ADD_LEAVE":
      return {
        ...input,
        leaves: [...input.leaves.filter((l) => l.id !== change.leave.id), change.leave],
      };
    case "REMOVE_LEAVE":
      return { ...input, leaves: input.leaves.filter((l) => l.id !== change.leaveId) };
    case "MAKE_UNAVAILABLE":
      return {
        ...input,
        leaves: [
          ...input.leaves,
          {
            id: `unavailable:${change.employeeId}:${change.fromDate}`,
            employeeId: change.employeeId,
            fromDate: change.fromDate,
            toDate: change.toDate,
            type: "PLANNED",
            status: "APPROVED",
          },
        ],
      };
    case "CHANGE_RULE":
      return {
        ...input,
        brandProcesses: input.brandProcesses.map((b) =>
          b.id === change.brandProcessId ? { ...b, ...change.patch } : b,
        ),
      };
    case "CHANGE_MIN_STAFF":
      return {
        ...input,
        brandProcesses: input.brandProcesses.map((b) =>
          b.id === change.brandProcessId
            ? {
                ...b,
                defaultMinStaff: change.defaultMinStaff ?? b.defaultMinStaff,
                weekdayMinStaff:
                  change.weekdayMinStaff === undefined ? b.weekdayMinStaff : change.weekdayMinStaff,
              }
            : b,
        ),
        coverageOverrides: change.override
          ? [
              ...input.coverageOverrides.filter(
                (o) =>
                  !(o.brandProcessId === change.brandProcessId && o.date === change.override!.date),
              ),
              { brandProcessId: change.brandProcessId, ...change.override },
            ]
          : input.coverageOverrides,
      };
  }
}

/** Dates a change can alter. A rule or minimum-staff change without a date touches the whole window. */
function affectedDates(input: EngineInput, change: EngineChange, window: string[]): Set<string> {
  switch (change.type) {
    case "ADD_LEAVE":
      return new Set(datesBetween(change.leave.fromDate, change.leave.toDate));
    case "REMOVE_LEAVE": {
      const l = input.leaves.find((x) => x.id === change.leaveId);
      return new Set(l ? datesBetween(l.fromDate, l.toDate) : []);
    }
    case "MAKE_UNAVAILABLE":
      return new Set(datesBetween(change.fromDate, change.toDate));
    case "CHANGE_MIN_STAFF":
      if (
        change.override &&
        change.defaultMinStaff === undefined &&
        change.weekdayMinStaff === undefined
      ) {
        return new Set([change.override.date]);
      }
      return new Set(window);
    case "CHANGE_RULE":
      return new Set(window);
  }
}

export function simulateChange(
  input: EngineInput,
  current: { draft: RosterDraft; issues?: Issue[] },
  change: EngineChange,
): SimulationResult {
  const newInput = applyChange(input, change);
  const weeks = weeksOfMonth(input.month);
  const window = weeks.flatMap((w) => w.fullWeek);
  const touched = affectedDates(input, change, window);
  const replanned = weeks.filter((w) => w.fullWeek.some((d) => touched.has(d)));
  const replannedDates = new Set(replanned.flatMap((w) => w.fullWeek));

  // Pin everything outside the affected weeks, everything before today, and every manual lock.
  const pins: DraftEntry[] = current.draft.entries.filter(
    (e) =>
      !replannedDates.has(e.date) ||
      e.locked ||
      (input.today !== undefined && e.date < input.today),
  );

  const regenerated = generateRoster(newInput, {
    locks: pins,
    previous: current.draft,
    suggestions: false,
  });
  const newIssues = analyzeRoster(newInput, regenerated.draft);
  const before: RosterSnapshot = {
    draft: current.draft,
    issues: current.issues ?? validateRoster(input, current.draft),
  };
  const diff = diffRosters(before, { draft: regenerated.draft, issues: newIssues });
  return {
    newInput,
    newDraft: regenerated.draft,
    newIssues,
    changedCells: diff.changedCells,
    issueDelta: diff.issueDelta,
    suggestions: diff.issueDelta.added.flatMap((i) => i.suggestions),
    replannedWeeks: replanned.map((w) => w.monday),
  };
}
