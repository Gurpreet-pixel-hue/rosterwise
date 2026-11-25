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

export type IssueWithAck = Issue & { acknowledgement: Acknowledgement | null };

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

async function loadDraft(db: Db, roster: Roster): Promise<RosterDraft> {
  const rows = await db.rosterEntry.findMany({
    where: { rosterId: roster.id },
    orderBy: [{ employeeId: "asc" }, { date: "asc" }],
  });
  const entries: DraftEntry[] = rows.map((e) => ({
    employeeId: e.employeeId,
    date: e.date,
    status: e.status,
    coveredBrandProcessIds: [...e.coveredBrandProcessIds].sort(),
    locked: e.locked,
    source: e.source,
  }));
  return { month: roster.month, entries, compOffEarned: [] };
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

const ids = (issues: Issue[]) => new Set(issues.map((i) => i.id));
const codes = (issues: Issue[]) => issues.map((i) => i.code).sort();

// ---------------------------------------------------------------------------------------------
// Reading a roster with its issues and acknowledgements
// ---------------------------------------------------------------------------------------------

export interface RosterView {
  roster: RosterSummary;
  isLatest: boolean;
  entries: DraftEntry[];
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
  const [input, draft, latest, acks] = await Promise.all([
    loadEngineInput(prisma, roster.month),
    loadDraft(prisma, roster),
    latestRoster(prisma, roster.month),
    prisma.issueAck.findMany({ where: { rosterId } }),
  ]);
  const issues = opts.suggestions ? analyzeRoster(input, draft) : validateRoster(input, draft);
  const ackById = new Map(acks.map((a) => [a.issueId, a]));
  const withAck: IssueWithAck[] = issues.map((i) => {
    const a = ackById.get(i.id);
    return {
      ...i,
      acknowledgement: a
        ? { issueId: a.issueId, note: a.note, actor: a.actor, createdAt: a.createdAt.toISOString() }
        : null,
    };
  });
  return {
    roster: summarise(roster),
    isLatest: latest?.id === roster.id,
    entries: draft.entries,
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
  /** Acknowledgements copied from the previous version because the same ERROR still exists. */
  carriedAcknowledgements: number;
}

/** Copy acknowledgements across versions for ERRORs whose stable id still exists. Returns how many. */
async function carryAcknowledgements(
  db: Db,
  fromRosterId: string | null,
  toRosterId: string,
  issues: Issue[],
): Promise<number> {
  if (!fromRosterId) return 0;
  const errorIds = ids(issues.filter((i) => i.severity === "ERROR"));
  const acks = await db.issueAck.findMany({ where: { rosterId: fromRosterId } });
  const keep = acks.filter((a) => errorIds.has(a.issueId));
  if (keep.length > 0) {
    await db.issueAck.createMany({
      data: keep.map((a) => ({
        rosterId: toRosterId,
        issueId: a.issueId,
        note: a.note,
        actor: a.actor,
      })),
    });
  }
  return keep.length;
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
      const carried = await carryAcknowledgements(tx, latest?.id ?? null, roster.id, gen.issues);
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
        },
      });
      return { roster: summarise(roster), issues: gen.issues, carriedAcknowledgements: carried };
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
    const fresh = await rosterRow(tx, roster.id);
    requireDraft(fresh);
    await requireLatest(tx, fresh);
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
  const issuesBefore = validateRoster(input, draft);
  const sim = simulateChange(input, { draft, issues: issuesBefore }, change);
  return { roster, input, draft, change, issuesBefore, sim };
}

/** Preview a change without saving anything. */
export async function simulateRosterChange(
  prisma: PrismaClient,
  raw: unknown,
): Promise<SimulationOutput> {
  const { rosterId, change, today } = parse(SimulateChangeInput, raw, "change");
  const { issuesBefore, sim } = await simulate(prisma, rosterId, change, today);
  return {
    changedCells: sim.changedCells,
    issueDelta: sim.issueDelta,
    suggestions: sim.suggestions,
    replannedWeeks: sim.replannedWeeks,
    errorsBefore: issuesBefore.filter((i) => i.severity === "ERROR").length,
    errorsAfter: sim.newIssues.filter((i) => i.severity === "ERROR").length,
  };
}

export interface ApplyChangeResult extends SimulationOutput {
  roster: RosterSummary;
  issues: Issue[];
  carriedAcknowledgements: number;
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
  const { roster, change, issuesBefore, sim } = await simulate(prisma, rosterId, rawChange, today);
  await requireLatest(prisma, roster);

  const summary: SimulationOutput = {
    changedCells: sim.changedCells,
    issueDelta: sim.issueDelta,
    suggestions: sim.suggestions,
    replannedWeeks: sim.replannedWeeks,
    errorsBefore: issuesBefore.filter((i) => i.severity === "ERROR").length,
    errorsAfter: sim.newIssues.filter((i) => i.severity === "ERROR").length,
  };

  try {
    return await prisma.$transaction(async (tx) => {
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
      const carried = await carryAcknowledgements(tx, fresh.id, next.id, sim.newIssues);
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
        },
      });
      return {
        ...summary,
        roster: summarise(next),
        issues: sim.newIssues,
        carriedAcknowledgements: carried,
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

function unacknowledgedErrors(
  issues: Issue[],
  acks: ReadonlyArray<{ issueId: string; note: string }>,
): Issue[] {
  const acked = new Set(acks.filter((a) => a.note.trim().length > 0).map((a) => a.issueId));
  return issues.filter((i) => i.severity === "ERROR" && !acked.has(i.id));
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
    const ack = await tx.issueAck.upsert({
      where: { rosterId_issueId: { rosterId, issueId } },
      create: { rosterId, issueId, note, actor },
      update: { note, actor },
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
}

/** Publish the latest draft. Blocked while any ERROR lacks an acknowledgement with a note. */
export async function publishRoster(prisma: PrismaClient, raw: unknown): Promise<PublishResult> {
  const { rosterId, actor } = parse(PublishInput, raw, "publish request");
  const roster = await rosterRow(prisma, rosterId);
  requireDraft(roster);
  await requireLatest(prisma, roster);
  const [input, draft] = await Promise.all([
    loadEngineInput(prisma, roster.month),
    loadDraft(prisma, roster),
  ]);
  const issues = validateRoster(input, draft);
  const acks = await prisma.issueAck.findMany({ where: { rosterId } });
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
  return prisma.$transaction(async (tx) => {
    const fresh = await rosterRow(tx, roster.id);
    requireDraft(fresh);
    await requireLatest(tx, fresh);
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
          data: { employeeId: c.employeeId, earnedOn: c.earnedOn, reason: c.reason },
        });
        created++;
      }
    }
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
      },
    });
    return {
      roster: summarise(published),
      acknowledgedErrors,
      warnings,
      compOffCreditsCreated: created,
    };
  });
}
