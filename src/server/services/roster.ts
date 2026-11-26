// Roster persistence and workflow (CLAUDE.md P3): generate, manual edit, simulate, apply, acknowledge, publish.
//
// Rules this layer enforces (the engine does the scheduling and the checking, this layer decides what
// may be saved):
//  - A roster is one VERSION of a month. Only the LATEST version can be changed; older ones are history.
//  - Only a DRAFT can be edited. A PUBLISHED roster is never edited in place: a change creates a new
//    DRAFT version (parentVersionId) that must be published again.
//  - A manual edit is validated by the shared validateRoster() first and returns the issue delta; it is
//    only written on commit. Edits are saved locked (source MANUAL) so regeneration keeps them.
//  - Publishing is blocked while any ERROR lacks an acknowledgement with a note.
//  - Every mutation writes an AuditLog row, in the same transaction as the change.
import { Prisma, type PrismaClient, type Roster } from "@prisma/client";
import { analyzeRoster, compOffEarnedFor } from "../../engine/analyze";
import { applyEdits } from "../../engine/edit";
import { diffRosters, type CellChange } from "../../engine/diff";
import { generateRoster } from "../../engine/generate";
import { simulateChange } from "../../engine/change";
import type {
  DraftEntry,
  EngineChange,
  EngineInput,
  Issue,
  IssueDelta,
  RosterDraft,
  Suggestion,
} from "../../engine/types";
import { validateRoster } from "../../engine/validate";
import { writeAudit, type Db } from "../audit";
import { ServiceError, parse } from "../errors";
import { loadEngineInput } from "../loadEngineInput";
import {
  AckInput,
  ApplyChangeInput,
  GenerateInput,
  ManualEditInput,
  PublishInput,
  SimulateChangeInput,
  actorSchema,
  type ChangeInputT,
} from "../schemas";

// ---------------------------------------------------------------------------------------------
// Shapes returned to callers
// ---------------------------------------------------------------------------------------------

export interface RosterSummary {
  id: string;
  month: string;
  version: number;
  status: "DRAFT" | "PUBLISHED";
  parentVersionId: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface Acknowledgement {
  issueId: string;
  note: string;
  actor: string;
  createdAt: string;
}

/**
 * `acknowledgement` is set only while the issue reads exactly as it did when acknowledged. If the same
 * issue (same stable id) now says something else, for example a gap that went from "1 of 2" to "0 of 2",
 * the old acknowledgement is shown as `changedSince` and the issue is a blocker again.
 */
export type IssueWithAck = Issue & {
  acknowledgement: Acknowledgement | null;
  changedSince: (Acknowledgement & { previousMessage: string }) | null;
};

const summarise = (r: Roster): RosterSummary => ({
  id: r.id,
  month: r.month,
  version: r.version,
  status: r.status,
  parentVersionId: r.parentVersionId,
  createdAt: r.createdAt.toISOString(),
  publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
});

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

async function rosterRow(db: Db, rosterId: string): Promise<Roster> {
  const r = await db.roster.findUnique({ where: { id: rosterId } });
  if (!r) throw new ServiceError("NOT_FOUND", `Roster "${rosterId}" was not found`);
  return r;
}

export const latestRoster = (db: Db, month: string) =>
  db.roster.findFirst({ where: { month }, orderBy: { version: "desc" } });

/** Only the newest version of a month may be changed: anything else is a stale view. */
async function requireLatest(db: Db, roster: Roster): Promise<void> {
  const latest = await latestRoster(db, roster.month);
  if (latest && latest.id !== roster.id) {
    throw new ServiceError(
      "CONFLICT",
      `This is version ${roster.version} of ${roster.month}, but version ${latest.version} exists. Reload and work on the latest version.`,
    );
  }
}

function requireDraft(roster: Roster): void {
  if (roster.status === "PUBLISHED") {
    throw new ServiceError(
      "CONFLICT",
      `Version ${roster.version} of ${roster.month} is published and cannot be edited. Apply a change to create a new draft version instead.`,
    );
  }
}

const monthOfDate = (date: string) => date.slice(0, 7);

/**
 * A roster stores a copy of every cell in its planning window, including the spill days of the
 * neighbouring months (December holds 30 Nov and 1 to 3 Jan). A copy of a day belonging to ANOTHER month
 * is not authoritative: that month's latest roster is. So on every read the spill cells are overlaid from
 * the neighbour that owns the date, and the same overlay feeds the validator, the publish gate, simulation
 * and the next generation. Two rosters therefore never disagree about a shared day, and a change in one
 * shows up as real issues in the other (for example December's `WEEKLY_OFF_NOT_GRANTED` when January now
 * has Aarav working on 3 Jan). With no neighbour roster the stored cell stays, as the provisional
 * plan it is (ASSUMPTIONS 22b).
 */
/**
 * Serialise writers on one roster: take its row lock for the rest of the transaction. Publishing, a committed
 * edit, an acknowledgement or its withdrawal, and applying a change each lock first, so none of them can slip
 * in between another's check and its write (a publish that validated, then an un-acknowledge, then the publish
 * committing, would otherwise publish an ERROR that is no longer acknowledged).
 */
async function lockRoster(tx: Db, rosterId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Roster" WHERE "id" = ${rosterId} FOR UPDATE`;
}

async function loadDraftWithOwners(
  db: Db,
  roster: Roster,
): Promise<{ draft: RosterDraft; foreignDates: Map<string, string> }> {
  const rows = await db.rosterEntry.findMany({
    where: { rosterId: roster.id },
    orderBy: [{ employeeId: "asc" }, { date: "asc" }],
  });
  const spillByMonth = new Map<string, Set<string>>();
  for (const r of rows) {
    const m = monthOfDate(r.date);
    if (m === roster.month) continue;
    const set = spillByMonth.get(m) ?? new Set<string>();
    set.add(r.date);
    spillByMonth.set(m, set);
  }
  const owned = new Map<string, (typeof rows)[number]>(); // `${employeeId}|${date}` -> the owner's cell
  const foreignDates = new Map<string, string>(); // date -> the month whose roster owns it
  for (const [month, dates] of spillByMonth) {
    const neighbour = await latestRoster(db, month);
    if (!neighbour) continue;
    const theirs = await db.rosterEntry.findMany({
      where: { rosterId: neighbour.id, date: { in: [...dates] } },
    });
    for (const t of theirs) {
      owned.set(`${t.employeeId}|${t.date}`, t);
      foreignDates.set(t.date, month);
    }
  }
  const entries: DraftEntry[] = rows.map((e) => {
    const t = owned.get(`${e.employeeId}|${e.date}`);
    const src = t ?? e;
    return {
      employeeId: e.employeeId,
      date: e.date,
      status: src.status,
      coveredBrandProcessIds: [...src.coveredBrandProcessIds].sort(),
      // a day owned elsewhere cannot be changed from here, so it is a fixed input, as the generator treats it
      locked: t ? true : e.locked,
      source: src.source,
    };
  });
  return { draft: { month: roster.month, entries, compOffEarned: [] }, foreignDates };
}

const loadDraft = async (db: Db, roster: Roster): Promise<RosterDraft> =>
  (await loadDraftWithOwners(db, roster)).draft;

/**
 * A cell is edited in the roster of the month the DATE belongs to. A spill day whose month has its own
 * roster is refused here: edit it there (it then shows in this roster by the overlay above).
 */
async function requireOwnCell(db: Db, roster: Roster, date: string): Promise<void> {
  const month = monthOfDate(date);
  if (month === roster.month) return;
  if (!(await latestRoster(db, month))) return; // provisional spill: this roster is the only holder
  throw new ServiceError(
    "CONFLICT",
    `${date} belongs to the ${month} roster, which already exists, so it cannot be edited from the ${roster.month} roster. Edit it in the ${month} roster; it then shows here.`,
  );
}

const entryData = (rosterId: string, e: DraftEntry) => ({
  rosterId,
  employeeId: e.employeeId,
  date: e.date,
  status: e.status,
  coveredBrandProcessIds: e.coveredBrandProcessIds,
  locked: e.locked,
  source: e.source,
});

const codes = (issues: Issue[]) => issues.map((i) => i.code).sort();

// ---------------------------------------------------------------------------------------------
// Reading a roster with its issues and acknowledgements
// ---------------------------------------------------------------------------------------------

export interface RosterView {
  roster: RosterSummary;
  isLatest: boolean;
  entries: DraftEntry[];
  /** Dates in this roster's window that another month's roster owns, so they cannot be edited here. */
  foreignDates: Record<string, string>;
  issues: IssueWithAck[];
  /** ERRORs that still block publishing. */
  blockers: Issue[];
}

export async function getRoster(
  prisma: PrismaClient,
  rosterId: string,
  opts: { suggestions?: boolean } = {},
): Promise<RosterView> {
  const roster = await rosterRow(prisma, rosterId);
  const [input, loaded, latest, acks] = await Promise.all([
    loadEngineInput(prisma, roster.month),
    loadDraftWithOwners(prisma, roster),
    latestRoster(prisma, roster.month),
    prisma.issueAck.findMany({ where: { rosterId } }),
  ]);
  const { draft, foreignDates } = loaded;
  const issues = opts.suggestions ? analyzeRoster(input, draft) : validateRoster(input, draft);
  const ackById = new Map(acks.map((a) => [a.issueId, a]));
  const withAck: IssueWithAck[] = issues.map((i) => {
    const a = ackById.get(i.id);
    const shape = a
      ? { issueId: a.issueId, note: a.note, actor: a.actor, createdAt: a.createdAt.toISOString() }
      : null;
    const current = a !== undefined && a.message === i.message;
    return {
      ...i,
      acknowledgement: current ? shape : null,
      changedSince: a && shape && !current ? { ...shape, previousMessage: a.message } : null,
    };
  });
  return {
    roster: summarise(roster),
    isLatest: latest?.id === roster.id,
    entries: draft.entries,
    foreignDates: Object.fromEntries(foreignDates),
    issues: withAck,
    blockers: unacknowledgedErrors(issues, acks),
  };
}

export async function listRosterVersions(
  prisma: PrismaClient,
  month: string,
): Promise<RosterSummary[]> {
  const rows = await prisma.roster.findMany({ where: { month }, orderBy: { version: "asc" } });
  return rows.map(summarise);
}

// ---------------------------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------------------------

export interface GenerateResult {
  roster: RosterSummary;
  issues: Issue[];
  /** Acknowledgements carried from the previous version because the same ERROR still reads the same. */
  carriedAcknowledgements: number;
  /** Acknowledged ERRORs that still exist but now read differently: they block publishing again. */
  changedSinceAcknowledged: number;
}

/**
 * Copy acknowledgements across versions for ERRORs whose stable id still exists. The stored message
 * travels with the acknowledgement, so one whose issue has since changed is copied (to show it as
 * "acknowledged earlier, changed since") but does not unblock publishing: `unacknowledgedErrors` compares
 * messages. Returns how many still count, and how many were copied but no longer match.
 */
async function carryAcknowledgements(
  db: Db,
  fromRosterId: string | null,
  toRosterId: string,
  issues: Issue[],
): Promise<{ carried: number; changedSince: number }> {
  if (!fromRosterId) return { carried: 0, changedSince: 0 };
  const errorById = new Map(issues.filter((i) => i.severity === "ERROR").map((i) => [i.id, i]));
  const acks = await db.issueAck.findMany({ where: { rosterId: fromRosterId } });
  const keep = acks.filter((a) => errorById.has(a.issueId));
  if (keep.length > 0) {
    await db.issueAck.createMany({
      data: keep.map((a) => ({
        rosterId: toRosterId,
        issueId: a.issueId,
        note: a.note,
        actor: a.actor,
        message: a.message,
      })),
    });
  }
  const carried = keep.filter((a) => errorById.get(a.issueId)?.message === a.message).length;
  return { carried, changedSince: keep.length - carried };
}

/**
 * Generate (or re-generate) a month. A new VERSION is created every time; locked entries and, if `today`
 * is given, everything before it are kept from the previous version.
 */
export async function generateMonth(prisma: PrismaClient, raw: unknown): Promise<GenerateResult> {
  const { month, actor, today } = parse(GenerateInput, raw, "generate request");
  const input = await loadEngineInput(prisma, month, { today });
  const latest = await latestRoster(prisma, month);
  const previous = latest ? await loadDraft(prisma, latest) : undefined;

  const gen = generateRoster(input, {
    locks: previous?.entries.filter((e) => e.locked) ?? [],
    previous,
    suggestions: false,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const stillLatest = await latestRoster(tx, month);
      if ((stillLatest?.id ?? null) !== (latest?.id ?? null)) {
        throw new ServiceError(
          "CONFLICT",
          `${month} was generated by someone else a moment ago. Reload and try again.`,
        );
      }
      const roster = await tx.roster.create({
        data: {
          month,
          version: (latest?.version ?? 0) + 1,
          status: "DRAFT",
          parentVersionId: latest?.id ?? null,
        },
      });
      await tx.rosterEntry.createMany({
        data: gen.draft.entries.map((e) => entryData(roster.id, e)),
      });
      const { carried, changedSince } = await carryAcknowledgements(
        tx,
        latest?.id ?? null,
        roster.id,
        gen.issues,
      );
      await writeAudit(tx, {
        actor,
        action: "GENERATE",
        entity: "Roster",
        entityId: roster.id,
        rosterId: roster.id,
        after: {
          month,
          version: roster.version,
          parentVersionId: roster.parentVersionId,
          entries: gen.draft.entries.length,
          errors: gen.issues.filter((i) => i.severity === "ERROR").length,
          warnings: gen.issues.filter((i) => i.severity === "WARNING").length,
          lockedEntriesKept: previous?.entries.filter((e) => e.locked).length ?? 0,
          carriedAcknowledgements: carried,
          changedSinceAcknowledged: changedSince,
        },
      });
      return {
        roster: summarise(roster),
        issues: gen.issues,
        carriedAcknowledgements: carried,
        changedSinceAcknowledged: changedSince,
      };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ServiceError(
        "CONFLICT",
        `${month} was generated by someone else a moment ago. Reload and try again.`,
      );
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Manual edit: validate first, return the issue delta, commit only on request
// ---------------------------------------------------------------------------------------------

export interface ManualEditResult {
  committed: boolean;
  /** Issues this edit would add or resolve (added ones come with suggestions). */
  delta: IssueDelta;
  errorsBefore: number;
  errorsAfter: number;
  /** Total issues after the edit, so a caller can refresh without another round trip. */
  issuesAfter: Issue[];
}

export async function manualEdit(
  prisma: PrismaClient,
  raw: unknown,
  opts: { commit: boolean },
): Promise<ManualEditResult> {
  const edit = parse(ManualEditInput, raw, "edit");
  const roster = await rosterRow(prisma, edit.rosterId);
  requireDraft(roster);
  await requireLatest(prisma, roster);
  await requireOwnCell(prisma, roster, edit.date);

  const [input, draft] = await Promise.all([
    loadEngineInput(prisma, roster.month),
    loadDraft(prisma, roster),
  ]);

  const before = draft.entries.find(
    (e) => e.employeeId === edit.employeeId && e.date === edit.date,
  );
  if (!before) {
    throw new ServiceError(
      "VALIDATION",
      `There is no roster cell for employee "${edit.employeeId}" on ${edit.date} (it must be an active employee and a date in the planning window of ${roster.month}).`,
    );
  }
  const known = new Set(input.brandProcesses.map((b) => b.id));
  const unknown = edit.coveredBrandProcessIds.filter((id) => !known.has(id));
  if (unknown.length > 0)
    throw new ServiceError("VALIDATION", `Unknown brand-process id(s): ${unknown.join(", ")}`);
  if (edit.status !== "WORK" && edit.coveredBrandProcessIds.length > 0) {
    throw new ServiceError(
      "VALIDATION",
      "Only a WORK entry can cover brand-processes. Clear the coverage or set the status to WORK.",
    );
  }

  const issuesBefore = validateRoster(input, draft);
  const next = applyEdits(
    draft,
    [
      {
        employeeId: edit.employeeId,
        date: edit.date,
        status: edit.status,
        coveredBrandProcessIds: edit.coveredBrandProcessIds,
      },
    ],
    { locked: true, source: "MANUAL" },
  );
  const issuesAfter = analyzeRoster(input, next);
  const delta = diffRosters(
    { draft, issues: issuesBefore },
    { draft: next, issues: issuesAfter },
  ).issueDelta;
  const result = {
    delta,
    errorsBefore: issuesBefore.filter((i) => i.severity === "ERROR").length,
    errorsAfter: issuesAfter.filter((i) => i.severity === "ERROR").length,
    issuesAfter,
  };
  if (!opts.commit) return { committed: false, ...result };

  const after = next.entries.find((e) => e.employeeId === edit.employeeId && e.date === edit.date)!;
  await prisma.$transaction(async (tx) => {
    await lockRoster(tx, roster.id);
    const fresh = await rosterRow(tx, roster.id);
    requireDraft(fresh);
    await requireLatest(tx, fresh);
    await requireOwnCell(tx, fresh, edit.date);
    await tx.rosterEntry.update({
      where: {
        rosterId_employeeId_date: {
          rosterId: roster.id,
          employeeId: edit.employeeId,
          date: edit.date,
        },
      },
      data: {
        status: after.status,
        coveredBrandProcessIds: after.coveredBrandProcessIds,
        locked: true,
        source: "MANUAL",
      },
    });
    await writeAudit(tx, {
      actor: edit.actor,
      action: "MANUAL_EDIT",
      entity: "RosterEntry",
      entityId: `${edit.employeeId}|${edit.date}`,
      rosterId: roster.id,
      before: {
        status: before.status,
        coveredBrandProcessIds: before.coveredBrandProcessIds,
        locked: before.locked,
        source: before.source,
      },
      after: {
        status: after.status,
        coveredBrandProcessIds: after.coveredBrandProcessIds,
        locked: true,
        source: "MANUAL",
        issuesAdded: codes(delta.added),
        issuesResolved: codes(delta.resolved),
      },
    });
  });
  return { committed: true, ...result };
}

export const previewManualEdit = (prisma: PrismaClient, raw: unknown) =>
  manualEdit(prisma, raw, { commit: false });
export const saveManualEdit = (prisma: PrismaClient, raw: unknown) =>
  manualEdit(prisma, raw, { commit: true });

// ---------------------------------------------------------------------------------------------
// Simulate and apply a change
// ---------------------------------------------------------------------------------------------

export interface SimulationOutput {
  changedCells: CellChange[];
  issueDelta: IssueDelta;
  suggestions: Suggestion[];
  replannedWeeks: string[];
  errorsBefore: number;
  errorsAfter: number;
  /**
   * Other months whose roster exists and whose days this change also touches. This roster re-plans only its
   * own days, so those rosters are NOT re-planned: apply the same change there too (their validator already
   * flags what the change breaks, e.g. `WORK_WHILE_UNAVAILABLE`).
   */
  affectedMonths: string[];
}

/** Check the change refers to real rows and turn it into the engine's change type. */
function parseChange(input: EngineInput, raw: ChangeInputT): EngineChange {
  const employee = (id: string) => {
    if (!input.employees.some((e) => e.id === id))
      throw new ServiceError("VALIDATION", `Unknown employee "${id}"`);
  };
  const bpExists = (id: string) => {
    if (!input.brandProcesses.some((b) => b.id === id))
      throw new ServiceError("VALIDATION", `Unknown brand-process "${id}"`);
  };
  switch (raw.type) {
    case "ADD_LEAVE": {
      employee(raw.leave.employeeId);
      const id = raw.leave.id ?? `new:${raw.leave.employeeId}:${raw.leave.fromDate}`;
      if (raw.leave.id && !input.leaves.some((l) => l.id === raw.leave.id)) {
        throw new ServiceError("VALIDATION", `Unknown leave "${raw.leave.id}"`);
      }
      return { type: "ADD_LEAVE", leave: { ...raw.leave, id } };
    }
    case "REMOVE_LEAVE":
      if (!input.leaves.some((l) => l.id === raw.leaveId))
        throw new ServiceError("VALIDATION", `Unknown leave "${raw.leaveId}"`);
      return raw;
    case "MAKE_UNAVAILABLE":
      employee(raw.employeeId);
      return raw;
    case "CHANGE_RULE":
      bpExists(raw.brandProcessId);
      return raw as EngineChange;
    case "CHANGE_MIN_STAFF":
      bpExists(raw.brandProcessId);
      return raw as EngineChange;
  }
}
/**
 * The dates a change is about, or null when it applies to every day (a rule or a standing minimum).
 * A one-day override is date-bound; a default or weekday minimum is not.
 */
function changeDateRange(
  input: EngineInput,
  change: EngineChange,
): { from: string; to: string } | null {
  switch (change.type) {
    case "ADD_LEAVE":
      return { from: change.leave.fromDate, to: change.leave.toDate };
    case "MAKE_UNAVAILABLE":
      return { from: change.fromDate, to: change.toDate };
    case "REMOVE_LEAVE": {
      const l = input.leaves.find((x) => x.id === change.leaveId);
      return l ? { from: l.fromDate, to: l.toDate } : null;
    }
    case "CHANGE_MIN_STAFF":
      return change.override &&
        change.defaultMinStaff === undefined &&
        change.weekdayMinStaff === undefined
        ? { from: change.override.date, to: change.override.date }
        : null;
    case "CHANGE_RULE":
      return null;
  }
}

/** Every YYYY-MM from `from` to `to`, without enumerating each day. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    if (m === 12) [y, m] = [y + 1, 1];
    else m += 1;
  }
  return out;
}

/**
 * A change re-plans one roster, and a roster plans only the days of its own month. A change that falls
 * entirely in another month's days would be "applied" with nothing re-planned here, while the roster that
 * owns those days is never touched. So it is refused, naming where to apply it. A change that only partly
 * falls elsewhere is allowed and reports that month in `affectedMonths`.
 */
async function checkChangeScope(
  db: Db,
  roster: Roster,
  input: EngineInput,
  change: EngineChange,
): Promise<string[]> {
  const range = changeDateRange(input, change);
  if (!range) return [];
  const months = monthsBetween(range.from, range.to);
  if (!months.includes(roster.month)) {
    throw new ServiceError(
      "CONFLICT",
      `This change falls on ${range.from === range.to ? range.from : `${range.from} to ${range.to}`}, which belongs to the ${months.join(" and ")} roster, not ${roster.month}. Apply it from the ${months[0]} roster, which owns those days.`,
    );
  }
  const others: string[] = [];
  for (const m of months) {
    if (m !== roster.month && (await latestRoster(db, m))) others.push(m);
  }
  return others;
}

async function simulate(
  prisma: PrismaClient,
  rosterId: string,
  rawChange: ChangeInputT,
  today?: string,
) {
  const roster = await rosterRow(prisma, rosterId);
  const [input, draft] = await Promise.all([
    loadEngineInput(prisma, roster.month, { today }),
    loadDraft(prisma, roster),
  ]);
  const change = parseChange(input, rawChange);
  const affectedMonths = await checkChangeScope(prisma, roster, input, change);
  const issuesBefore = validateRoster(input, draft);
  const sim = simulateChange(input, { draft, issues: issuesBefore }, change);
  return { roster, input, draft, change, issuesBefore, sim, affectedMonths };
}

/** Preview a change without saving anything. */
export async function simulateRosterChange(
  prisma: PrismaClient,
  raw: unknown,
): Promise<SimulationOutput> {
  const { rosterId, change, today } = parse(SimulateChangeInput, raw, "change");
  const { issuesBefore, sim, affectedMonths } = await simulate(prisma, rosterId, change, today);
  return {
    changedCells: sim.changedCells,
    issueDelta: sim.issueDelta,
    suggestions: sim.suggestions,
    replannedWeeks: sim.replannedWeeks,
    errorsBefore: issuesBefore.filter((i) => i.severity === "ERROR").length,
    errorsAfter: sim.newIssues.filter((i) => i.severity === "ERROR").length,
    affectedMonths,
  };
}

export interface ApplyChangeResult extends SimulationOutput {
  roster: RosterSummary;
  issues: Issue[];
  carriedAcknowledgements: number;
  changedSinceAcknowledged: number;
}

/** Make the master-data effect of a change (the leave, the rule, the minimum), inside the caller's transaction. */
async function applyMasterDataEffect(tx: Db, change: EngineChange): Promise<void> {
  switch (change.type) {
    case "ADD_LEAVE": {
      const l = change.leave;
      const data = {
        employeeId: l.employeeId,
        fromDate: l.fromDate,
        toDate: l.toDate,
        type: l.type,
        status: l.status,
      };
      const existing = l.id.startsWith("new:")
        ? null
        : await tx.leave.findUnique({ where: { id: l.id } });
      if (existing) await tx.leave.update({ where: { id: l.id }, data });
      else await tx.leave.create({ data: { ...data, note: "Added through a roster change" } });
      return;
    }
    case "REMOVE_LEAVE":
      await tx.leave.delete({ where: { id: change.leaveId } });
      return;
    case "MAKE_UNAVAILABLE":
      await tx.leave.create({
        data: {
          employeeId: change.employeeId,
          fromDate: change.fromDate,
          toDate: change.toDate,
          type: "PLANNED",
          status: "APPROVED",
          note: "Made unavailable through a roster change",
        },
      });
      return;
    case "CHANGE_RULE":
      await tx.brandProcess.update({
        where: { id: change.brandProcessId },
        data: {
          ...change.patch,
          customWeekdays: change.patch.customWeekdays
            ? [...change.patch.customWeekdays]
            : undefined,
        },
      });
      return;
    case "CHANGE_MIN_STAFF": {
      const data: Prisma.BrandProcessUpdateInput = {};
      if (change.defaultMinStaff !== undefined) data.defaultMinStaff = change.defaultMinStaff;
      if (change.weekdayMinStaff !== undefined) {
        data.weekdayMinStaff =
          change.weekdayMinStaff === null ? Prisma.JsonNull : change.weekdayMinStaff;
      }
      if (Object.keys(data).length > 0)
        await tx.brandProcess.update({ where: { id: change.brandProcessId }, data });
      if (change.override) {
        await tx.coverageOverride.upsert({
          where: {
            brandProcessId_date: {
              brandProcessId: change.brandProcessId,
              date: change.override.date,
            },
          },
          create: {
            brandProcessId: change.brandProcessId,
            date: change.override.date,
            minStaff: change.override.minStaff,
          },
          update: { minStaff: change.override.minStaff },
        });
      }
      return;
    }
  }
}

/**
 * Apply a change: save its master-data effect AND a new roster VERSION (parent = the one it was based on),
 * atomically. Only the latest version can be the base. The new version is always a DRAFT.
 */
export async function applyRosterChange(
  prisma: PrismaClient,
  raw: unknown,
): Promise<ApplyChangeResult> {
  const { rosterId, change: rawChange, actor, today } = parse(ApplyChangeInput, raw, "change");
  const { roster, change, issuesBefore, sim, affectedMonths } = await simulate(
    prisma,
    rosterId,
    rawChange,
    today,
  );
  await requireLatest(prisma, roster);

  const summary: SimulationOutput = {
    changedCells: sim.changedCells,
    issueDelta: sim.issueDelta,
    suggestions: sim.suggestions,
    replannedWeeks: sim.replannedWeeks,
    errorsBefore: issuesBefore.filter((i) => i.severity === "ERROR").length,
    errorsAfter: sim.newIssues.filter((i) => i.severity === "ERROR").length,
    affectedMonths,
  };

  try {
    return await prisma.$transaction(async (tx) => {
      await lockRoster(tx, roster.id);
      const fresh = await rosterRow(tx, roster.id);
      await requireLatest(tx, fresh);
      const next = await tx.roster.create({
        data: {
          month: roster.month,
          version: fresh.version + 1,
          status: "DRAFT",
          parentVersionId: fresh.id,
        },
      });
      await tx.rosterEntry.createMany({
        data: sim.newDraft.entries.map((e) => entryData(next.id, e)),
      });
      const { carried, changedSince } = await carryAcknowledgements(
        tx,
        fresh.id,
        next.id,
        sim.newIssues,
      );
      // Last, so that if the master-data effect fails the new version and its entries are rolled back too.
      await applyMasterDataEffect(tx, change);
      await writeAudit(tx, {
        actor,
        action: "APPLY_CHANGE",
        entity: "Roster",
        entityId: next.id,
        rosterId: next.id,
        before: {
          rosterId: fresh.id,
          version: fresh.version,
          status: fresh.status,
          errors: summary.errorsBefore,
        },
        after: {
          rosterId: next.id,
          version: next.version,
          change,
          cellsChanged: sim.changedCells.length,
          replannedWeeks: sim.replannedWeeks,
          issuesAdded: codes(sim.issueDelta.added),
          issuesResolved: codes(sim.issueDelta.resolved),
          errors: summary.errorsAfter,
          carriedAcknowledgements: carried,
          changedSinceAcknowledged: changedSince,
          alsoAffectsMonths: summary.affectedMonths,
        },
      });
      return {
        ...summary,
        roster: summarise(next),
        issues: sim.newIssues,
        carriedAcknowledgements: carried,
        changedSinceAcknowledged: changedSince,
      };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ServiceError(
        "CONFLICT",
        `A newer version of ${roster.month} was created at the same time. Reload and try again.`,
      );
    }
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      (e.code === "P2003" || e.code === "P2025")
    ) {
      throw new ServiceError(
        "VALIDATION",
        "The change refers to something that does not exist. Nothing was saved.",
      );
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Acknowledge and publish
// ---------------------------------------------------------------------------------------------

/** An ERROR is acknowledged only by a note on THIS wording of it (see IssueWithAck). */
function unacknowledgedErrors(
  issues: Issue[],
  acks: ReadonlyArray<{ issueId: string; note: string; message: string }>,
): Issue[] {
  const acked = new Map(
    acks.filter((a) => a.note.trim().length > 0).map((a) => [a.issueId, a.message]),
  );
  return issues.filter((i) => i.severity === "ERROR" && acked.get(i.id) !== i.message);
}

/** Accept an ERROR with a note so the roster can still be published. Only a current ERROR can be acknowledged. */
export async function acknowledgeIssue(
  prisma: PrismaClient,
  raw: unknown,
): Promise<Acknowledgement> {
  const { rosterId, issueId, note, actor } = parse(AckInput, raw, "acknowledgement");
  const roster = await rosterRow(prisma, rosterId);
  requireDraft(roster);
  await requireLatest(prisma, roster);
  const [input, draft] = await Promise.all([
    loadEngineInput(prisma, roster.month),
    loadDraft(prisma, roster),
  ]);
  const issue = validateRoster(input, draft).find((i) => i.id === issueId);
  if (!issue) {
    throw new ServiceError(
      "NOT_FOUND",
      `Issue "${issueId}" is not on this roster (it may have been resolved already).`,
    );
  }
  if (issue.severity !== "ERROR") {
    throw new ServiceError(
      "VALIDATION",
      `Only ERRORs need acknowledging; this is a ${issue.severity}.`,
    );
  }
  return prisma.$transaction(async (tx) => {
    await lockRoster(tx, rosterId);
    requireDraft(await rosterRow(tx, rosterId));
    const ack = await tx.issueAck.upsert({
      where: { rosterId_issueId: { rosterId, issueId } },
      create: { rosterId, issueId, note, actor, message: issue.message },
      update: { note, actor, message: issue.message },
    });
    await writeAudit(tx, {
      actor,
      action: "ACK_ISSUE",
      entity: "IssueAck",
      entityId: issueId,
      rosterId,
      after: {
        code: issue.code,
        employeeId: issue.employeeId ?? null,
        date: issue.date ?? null,
        note,
      },
    });
    return {
      issueId: ack.issueId,
      note: ack.note,
      actor: ack.actor,
      createdAt: ack.createdAt.toISOString(),
    };
  });
}

export async function removeAcknowledgement(
  prisma: PrismaClient,
  rosterId: string,
  issueId: string,
  actor: string = "manager",
): Promise<void> {
  const who = parse(actorSchema, actor, "actor");
  const roster = await rosterRow(prisma, rosterId);
  requireDraft(roster);
  await prisma.$transaction(async (tx) => {
    await lockRoster(tx, rosterId);
    requireDraft(await rosterRow(tx, rosterId));
    const ack = await tx.issueAck.findUnique({
      where: { rosterId_issueId: { rosterId, issueId } },
    });
    if (!ack) throw new ServiceError("NOT_FOUND", "That issue is not acknowledged");
    await tx.issueAck.delete({ where: { id: ack.id } });
    await writeAudit(tx, {
      actor: who,
      action: "UNACK_ISSUE",
      entity: "IssueAck",
      entityId: issueId,
      rosterId,
      before: { note: ack.note, actor: ack.actor },
    });
  });
}

export interface PublishResult {
  roster: RosterSummary;
  acknowledgedErrors: number;
  warnings: number;
  compOffCreditsCreated: number;
  /** Credits an earlier publish of this month created that this version no longer earns (unused ones are deleted). */
  compOffCreditsRetracted: number;
  /** No-longer-earned credits that were kept because the employee has already used them. */
  compOffCreditsKeptUsed: number;
}

/** Publish the latest draft. Blocked while any ERROR lacks an acknowledgement with a note. */
export async function publishRoster(prisma: PrismaClient, raw: unknown): Promise<PublishResult> {
  const { rosterId, actor } = parse(PublishInput, raw, "publish request");
  return prisma.$transaction(
    async (tx) => {
      // Lock first, then check and write under the lock: the gate and the publish see one state.
      await lockRoster(tx, rosterId);
      const roster = await rosterRow(tx, rosterId);
      requireDraft(roster);
      await requireLatest(tx, roster);
      const [input, draft] = await Promise.all([
        loadEngineInput(tx as PrismaClient, roster.month),
        loadDraft(tx, roster),
      ]);
      const issues = validateRoster(input, draft);
      const acks = await tx.issueAck.findMany({ where: { rosterId } });
      const blockers = unacknowledgedErrors(issues, acks);
      if (blockers.length > 0) {
        throw new ServiceError(
          "BLOCKED",
          `${blockers.length} ERROR(s) block publishing: fix them, or acknowledge each with a note. First: ${blockers[0].message}`,
          blockers.map((b) => ({
            issueId: b.id,
            code: b.code,
            employeeId: b.employeeId ?? null,
            date: b.date ?? null,
            message: b.message,
          })),
        );
      }
      const earned = compOffEarnedFor(input, draft);
      const published = await tx.roster.update({
        where: { id: roster.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });
      let created = 0;
      for (const c of earned) {
        const has = await tx.compOffCredit.findFirst({
          where: { employeeId: c.employeeId, earnedOn: c.earnedOn },
        });
        if (!has) {
          await tx.compOffCredit.create({
            data: {
              employeeId: c.employeeId,
              earnedOn: c.earnedOn,
              reason: c.reason,
              publishedByRosterId: roster.id,
            },
          });
          created++;
        }
      }
      // Retract: a credit that an earlier publish of THIS month created, for a holiday this version no longer
      // has that person working. Only publish-created credits are candidates (a manager-entered one has no
      // publishedByRosterId), and a credit already used stays: the leave is taken, so it is counted, not deleted.
      const stillEarned = new Set(earned.map((c) => `${c.employeeId}|${c.earnedOn}`));
      const earlierVersions = await tx.roster.findMany({
        where: { month: roster.month },
        select: { id: true },
      });
      const stale = (
        await tx.compOffCredit.findMany({
          where: {
            earnedOn: { startsWith: `${roster.month}-` },
            publishedByRosterId: { in: earlierVersions.map((r) => r.id) },
          },
        })
      ).filter((c) => !stillEarned.has(`${c.employeeId}|${c.earnedOn}`));
      const retractable = stale.filter((c) => c.usedOn === null);
      if (retractable.length > 0) {
        await tx.compOffCredit.deleteMany({ where: { id: { in: retractable.map((c) => c.id) } } });
      }
      const keptUsed = stale.length - retractable.length;
      const acknowledgedErrors = issues.filter((i) => i.severity === "ERROR").length;
      const warnings = issues.filter((i) => i.severity === "WARNING").length;
      await writeAudit(tx, {
        actor,
        action: "PUBLISH",
        entity: "Roster",
        entityId: roster.id,
        rosterId: roster.id,
        before: { status: "DRAFT" },
        after: {
          status: "PUBLISHED",
          version: published.version,
          acknowledgedErrors,
          warnings,
          compOffCreditsCreated: created,
          compOffCreditsRetracted: retractable.length,
          compOffCreditsKeptUsed: keptUsed,
          retracted: retractable.map((c) => `${c.employeeId}|${c.earnedOn}`),
        },
      });
      return {
        roster: summarise(published),
        acknowledgedErrors,
        warnings,
        compOffCreditsCreated: created,
        compOffCreditsRetracted: retractable.length,
        compOffCreditsKeptUsed: keptUsed,
      };
    },
    { timeout: 30_000 },
  );
}
