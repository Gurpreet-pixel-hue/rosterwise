import type { DraftEntry, EntryEdit, EntrySource, RosterDraft } from "./types";

export interface EditFlags {
  /** Mark the edited cells locked (manual edits are locked so regeneration keeps them). */
  locked?: boolean;
  source?: EntrySource;
}

/**
 * Apply cell edits to a draft and return a new draft. Edits to a cell that does not exist yet add it.
 * Pure: the input draft is not changed.
 */
export function applyEdits(
  draft: RosterDraft,
  edits: readonly EntryEdit[],
  flags: EditFlags = {},
): RosterDraft {
  const entries = new Map<string, DraftEntry>(
    draft.entries.map((e) => [`${e.employeeId}|${e.date}`, e]),
  );
  for (const edit of edits) {
    const key = `${edit.employeeId}|${edit.date}`;
    const before = entries.get(key);
    entries.set(key, {
      employeeId: edit.employeeId,
      date: edit.date,
      status: edit.status,
      coveredBrandProcessIds: [...edit.coveredBrandProcessIds].sort(),
      locked: flags.locked ?? before?.locked ?? false,
      source: flags.source ?? before?.source ?? "MANUAL",
    });
  }
  const sorted = [...entries.values()].sort(
    (a, b) =>
      (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0) ||
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  );
  return { ...draft, entries: sorted };
}
