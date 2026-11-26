// Integration tests against a REAL Postgres (TEST_DATABASE_URL): the roster workflow of CLAUDE.md P3.
// generate -> edit -> simulate -> apply -> acknowledge -> publish, and every path that must refuse.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateRoster } from "../../engine/generate";
import { simulateChange } from "../../engine/change";
import { weeksOfMonth } from "../../engine/calendar";
import type { Issue } from "../../engine/types";
import { ServiceError } from "../errors";
import { loadEngineInput } from "../loadEngineInput";
import { createRecord } from "../services/master";
import {
  acknowledgeIssue,
  applyRosterChange,
  generateMonth,
  getRoster,
  listRosterVersions,
  previewManualEdit,
  publishRoster,
  removeAcknowledgement,
  saveManualEdit,
  simulateRosterChange,
} from "../services/roster";
import { ANANYA, DEC, HAS_DB, closeDb, resetDb, testPrisma } from "./helpers";

const ISHITA = "emp-ishita-verma";
const DIVYA = "emp-divya-menon";
const AARAV = "emp-aarav-sharma";
const COASTAL_CS = "bp-coastal-candles-cs";
const COASTAL_ACC = "bp-coastal-candles-acc";

const prisma = () => testPrisma();
const errorsOf = (issues: Issue[]) => issues.filter((i) => i.severity === "ERROR");

/** The expected failure of a call, so a test can assert its code and that nothing was saved. */
async function failure(p: Promise<unknown>): Promise<ServiceError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError);
    return e as ServiceError;
  }
  throw new Error("expected the call to fail");
}

const counts = async () => {
  const p = prisma();
  const [rosters, entries, leaves, audits, acks, credits] = await Promise.all([
    p.roster.count(),
    p.rosterEntry.count(),
    p.leave.count(),
    p.auditLog.count(),
    p.issueAck.count(),
    p.compOffCredit.count(),
  ]);
  return { rosters, entries, leaves, audits, acks, credits };
};

const entryRow = (rosterId: string, employeeId: string, date: string) =>
  prisma().rosterEntry.findUniqueOrThrow({
    where: { rosterId_employeeId_date: { rosterId, employeeId, date } },
  });

const generate = (extra: Record<string, unknown> = {}) =>
  generateMonth(prisma(), { month: DEC, actor: "tester", ...extra });

/** Acknowledge every current ERROR of a roster with a note, one by one. */
async function ackAll(rosterId: string, note = "Accepted for the demo: no backup exists") {
  const view = await getRoster(prisma(), rosterId);
  for (const e of errorsOf(view.issues))
    await acknowledgeIssue(prisma(), { rosterId, issueId: e.id, note, actor: "tester" });
  return errorsOf(view.issues).length;
}

describe.skipIf(!HAS_DB)("roster workflow (integration, real Postgres)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(closeDb);

  // ---------------------------------------------------------------------------------------------
  describe("generate", () => {
    it("persists a DRAFT version: one entry per employee per window date, an audit row, and exactly Ananya's errors", async () => {
      const r = await generate();

      expect(r.roster).toMatchObject({
        month: DEC,
        version: 1,
        status: "DRAFT",
        parentVersionId: null,
        publishedAt: null,
      });
      // 32 employees x 35 dates (30 Nov to 3 Jan: every date of every Mon-Sun week touching December)
      expect(await prisma().rosterEntry.count({ where: { rosterId: r.roster.id } })).toBe(32 * 35);
      expect(
        await prisma().rosterEntry.count({ where: { rosterId: r.roster.id, date: "2027-01-03" } }),
      ).toBe(32); // spill entries
      const errs = errorsOf(r.issues);
      expect(errs).toHaveLength(5);
      expect(
        errs.every((e) => e.code === "WEEKLY_OFF_NOT_GRANTED" && e.employeeId === ANANYA),
      ).toBe(true);

      const audit = await prisma().auditLog.findMany({ where: { action: "GENERATE" } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: "tester", entity: "Roster", rosterId: r.roster.id });
      expect(audit[0].after).toMatchObject({ month: DEC, version: 1, errors: 5 });
    });

    it("stores exactly what the engine produced (nothing lost or invented in the database round trip)", async () => {
      const r = await generate();
      const input = await loadEngineInput(prisma(), DEC);
      const fresh = generateRoster(input, { suggestions: false }).draft;
      const stored = await prisma().rosterEntry.findMany({ where: { rosterId: r.roster.id } });
      const key = (e: { employeeId: string; date: string }) => `${e.employeeId}|${e.date}`;
      const byKey = new Map(stored.map((e) => [key(e), e]));
      expect(byKey.size).toBe(fresh.entries.length);
      for (const e of fresh.entries) {
        const row = byKey.get(key(e))!;
        expect([
          row.status,
          [...row.coveredBrandProcessIds].sort(),
          row.locked,
          row.source,
        ]).toEqual([e.status, e.coveredBrandProcessIds, e.locked, e.source]);
      }
    });

    it("generating again creates version 2 (parent = version 1), keeps locked entries, and leaves version 1 untouched", async () => {
      const v1 = await generate();
      await saveManualEdit(prisma(), {
        rosterId: v1.roster.id,
        employeeId: ISHITA,
        date: "2026-12-16",
        status: "WEEKLY_OFF",
        coveredBrandProcessIds: [],
        actor: "tester",
      });
      const v2 = await generate();

      expect(v2.roster).toMatchObject({
        version: 2,
        parentVersionId: v1.roster.id,
        status: "DRAFT",
      });
      expect(await entryRow(v2.roster.id, ISHITA, "2026-12-16")).toMatchObject({
        status: "WEEKLY_OFF",
        locked: true,
        source: "MANUAL",
      });
      expect((await entryRow(v1.roster.id, ISHITA, "2026-12-16")).locked).toBe(true); // v1 still there
      expect((await listRosterVersions(prisma(), DEC)).map((v) => v.version)).toEqual([1, 2]);
    });

    it("rejects a malformed request and saves nothing", async () => {
      const before = await counts();
      for (const bad of [
        { month: "2026-13" },
        { month: "December" },
        { month: DEC, today: "2026-02-30" },
        {},
      ]) {
        expect((await failure(generateMonth(prisma(), bad))).code).toBe("VALIDATION");
      }
      expect(await counts()).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("manual edit: validate first, commit on request", () => {
    // Sending Ishita (sole primary of Coastal Candles) off on a day Divya is not covering opens two gaps.
    const edit = (rosterId: string, over: Record<string, unknown> = {}) => ({
      rosterId,
      employeeId: ISHITA,
      date: "2026-12-16",
      status: "WEEKLY_OFF",
      coveredBrandProcessIds: [],
      actor: "tester",
      ...over,
    });

    it("previewing returns the issue delta, with suggestions, and writes nothing", async () => {
      const { roster } = await generate();
      const before = await counts();

      const p = await previewManualEdit(prisma(), edit(roster.id));

      expect(p.committed).toBe(false);
      const added = p.delta.added.filter((i) => i.code === "COVERAGE_GAP");
      expect(added.map((i) => i.brandProcessId).sort()).toEqual([COASTAL_ACC, COASTAL_CS]);
      expect(
        added.every(
          (i) =>
            i.date === "2026-12-16" &&
            i.suggestions.some((s) => s.type === "USE_BACKUP" && s.employeeId === DIVYA),
        ),
      ).toBe(true);
      expect(p.errorsAfter).toBe(p.errorsBefore + 2);
      expect(await counts()).toEqual(before); // no entry changed, no audit row
      expect((await entryRow(roster.id, ISHITA, "2026-12-16")).status).toBe("WORK");
    });

    it("committing saves the cell locked and manual, audits before and after, and the roster now shows the gaps", async () => {
      const { roster } = await generate();
      const c = await saveManualEdit(prisma(), edit(roster.id));

      expect(c.committed).toBe(true);
      expect(await entryRow(roster.id, ISHITA, "2026-12-16")).toMatchObject({
        status: "WEEKLY_OFF",
        locked: true,
        source: "MANUAL",
        coveredBrandProcessIds: [],
      });

      const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: "MANUAL_EDIT" } });
      expect(audit).toMatchObject({
        actor: "tester",
        rosterId: roster.id,
        entity: "RosterEntry",
        entityId: `${ISHITA}|2026-12-16`,
      });
      expect(audit.before).toMatchObject({ status: "WORK", locked: false, source: "AUTO" });
      expect(audit.after).toMatchObject({ status: "WEEKLY_OFF", locked: true, source: "MANUAL" });
      expect((audit.after as { issuesAdded: string[] }).issuesAdded).toEqual([
        "COVERAGE_GAP",
        "COVERAGE_GAP",
      ]);

      const view = await getRoster(prisma(), roster.id);
      expect(view.issues.filter((i) => i.code === "COVERAGE_GAP")).toHaveLength(2);
    });

    it("a follow-up edit that covers the gaps resolves them (the delta reports it)", async () => {
      const { roster } = await generate();
      await saveManualEdit(prisma(), edit(roster.id));
      const fix = await saveManualEdit(prisma(), {
        rosterId: roster.id,
        employeeId: DIVYA,
        date: "2026-12-16",
        status: "WORK",
        coveredBrandProcessIds: [COASTAL_CS, COASTAL_ACC],
        actor: "tester",
      });
      expect(fix.delta.resolved.filter((i) => i.code === "COVERAGE_GAP")).toHaveLength(2);
      expect(fix.errorsAfter).toBe(5); // back to Ananya's five
    });

    it("refuses bad edits with the right code and saves nothing", async () => {
      const { roster } = await generate();
      const before = await counts();
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ employeeId: "emp-nobody" }, "VALIDATION"], // no such cell
        [{ date: "2027-02-10" }, "VALIDATION"], // outside the planning window
        [{ date: "2026-12-32" }, "VALIDATION"], // not a date
        [{ status: "ON_FIRE" }, "VALIDATION"],
        [{ coveredBrandProcessIds: ["bp-nope"], status: "WORK" }, "VALIDATION"], // unknown brand-process
        [{ coveredBrandProcessIds: [COASTAL_CS], status: "WEEKLY_OFF" }, "VALIDATION"], // only WORK can cover
        [{ rosterId: "no-such-roster" }, "NOT_FOUND"],
      ];
      for (const [over, code] of cases) {
        expect(
          (await failure(saveManualEdit(prisma(), edit(roster.id, over)))).code,
          JSON.stringify(over),
        ).toBe(code);
      }
      expect(await counts()).toEqual(before);
    });

    it("refuses to edit a PUBLISHED roster in place, and a version that is no longer the latest", async () => {
      const v1 = await generate();
      await ackAll(v1.roster.id);
      await publishRoster(prisma(), { rosterId: v1.roster.id, actor: "tester" });
      const published = await failure(saveManualEdit(prisma(), edit(v1.roster.id)));
      expect(published.code).toBe("CONFLICT");
      expect(published.message).toContain("published");

      await resetDb();
      const a = await generate();
      const b = await generate(); // a is now stale
      const stale = await failure(saveManualEdit(prisma(), edit(a.roster.id)));
      expect(stale.code).toBe("CONFLICT");
      expect(stale.message).toContain(`version ${b.roster.version} exists`);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("simulate and apply a change", () => {
    const approveAarav = async () => {
      const pending = await prisma().leave.findFirstOrThrow({ where: { status: "PENDING" } });
      return {
        pending,
        change: {
          type: "ADD_LEAVE" as const,
          leave: {
            id: pending.id,
            employeeId: pending.employeeId,
            fromDate: pending.fromDate,
            toDate: pending.toDate,
            type: pending.type,
            status: "APPROVED" as const,
          },
        },
      };
    };

    it("simulating writes NOTHING and reports the cascade (scenario 4)", async () => {
      const { roster } = await generate();
      const { change } = await approveAarav();
      const before = await counts();

      const sim = await simulateRosterChange(prisma(), { rosterId: roster.id, change });

      expect(await counts()).toEqual(before);
      expect((await prisma().leave.findFirstOrThrow({ where: { employeeId: AARAV } })).status).toBe(
        "PENDING",
      );
      const cascade = sim.issueDelta.added.filter((i) => i.code === "CASCADE_GAP");
      expect(cascade.map((c) => c.date)).toEqual(["2026-12-29", "2026-12-30"]);
      expect(cascade[0].message).toContain("Lumen Skincare");
      expect(cascade[0].message).not.toContain("Atlas Footwear"); // Rahul Bhatt covers it
      expect(sim.replannedWeeks).toEqual(["2026-12-28"]);
      expect(sim.errorsAfter).toBeGreaterThan(sim.errorsBefore);
      expect(sim.suggestions.length).toBeGreaterThan(0);
    });

    it("refuses a change that refers to nothing real, or is malformed, and saves nothing", async () => {
      const { roster } = await generate();
      const before = await counts();
      const bad: unknown[] = [
        {
          type: "ADD_LEAVE",
          leave: {
            employeeId: "emp-nobody",
            fromDate: "2026-12-09",
            toDate: "2026-12-09",
            type: "PLANNED",
            status: "APPROVED",
          },
        },
        {
          type: "ADD_LEAVE",
          leave: {
            employeeId: AARAV,
            fromDate: "2026-12-10",
            toDate: "2026-12-09",
            type: "PLANNED",
            status: "APPROVED",
          },
        },
        {
          type: "ADD_LEAVE",
          leave: {
            id: "no-such-leave",
            employeeId: AARAV,
            fromDate: "2026-12-09",
            toDate: "2026-12-09",
            type: "PLANNED",
            status: "APPROVED",
          },
        },
        { type: "REMOVE_LEAVE", leaveId: "no-such-leave" },
        {
          type: "MAKE_UNAVAILABLE",
          employeeId: "emp-nobody",
          fromDate: "2026-12-09",
          toDate: "2026-12-09",
        },
        { type: "CHANGE_RULE", brandProcessId: "bp-nope", patch: { operatingRule: "ALL_DAYS" } },
        { type: "CHANGE_RULE", brandProcessId: COASTAL_CS, patch: {} },
        { type: "CHANGE_MIN_STAFF", brandProcessId: COASTAL_CS },
        { type: "TELEPORT" },
      ];
      for (const change of bad) {
        for (const fn of [simulateRosterChange, applyRosterChange]) {
          expect(
            (await failure(fn(prisma(), { rosterId: roster.id, change }))).code,
            JSON.stringify(change),
          ).toBe("VALIDATION");
        }
      }
      expect(await counts()).toEqual(before);
    });

    it("applying saves the leave AND a new DRAFT version (parent = the old one) atomically, matching the simulation", async () => {
      const v1 = await generate();
      const { pending, change } = await approveAarav();
      // what the engine says, computed independently of the service
      const input = await loadEngineInput(prisma(), DEC);
      const expected = simulateChange(
        input,
        {
          draft: {
            month: DEC,
            entries: (await getRoster(prisma(), v1.roster.id)).entries,
            compOffEarned: [],
          },
        },
        {
          type: "ADD_LEAVE",
          leave: { ...change.leave, id: pending.id },
        },
      );

      const r = await applyRosterChange(prisma(), {
        rosterId: v1.roster.id,
        change,
        actor: "tester",
      });

      expect((await prisma().leave.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
        "APPROVED",
      );
      expect(r.roster).toMatchObject({
        version: 2,
        status: "DRAFT",
        parentVersionId: v1.roster.id,
      });
      const stored = (await getRoster(prisma(), r.roster.id)).entries;
      expect(stored).toHaveLength(expected.newDraft.entries.length);
      const want = new Map(expected.newDraft.entries.map((e) => [`${e.employeeId}|${e.date}`, e]));
      for (const e of stored) {
        const w = want.get(`${e.employeeId}|${e.date}`)!;
        expect([e.status, e.coveredBrandProcessIds, e.locked, e.source]).toEqual([
          w.status,
          w.coveredBrandProcessIds,
          w.locked,
          w.source,
        ]);
      }
      const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: "APPLY_CHANGE" } });
      expect(audit).toMatchObject({ actor: "tester", rosterId: r.roster.id });
      expect(audit.after).toMatchObject({ version: 2, replannedWeeks: ["2026-12-28"] });
      expect((audit.after as { cellsChanged: number }).cellsChanged).toBe(r.changedCells.length);
      expect(audit.before).toMatchObject({ rosterId: v1.roster.id, version: 1 });
    });

    it("a change outside a week leaves that week's offs and everything else byte-identical", async () => {
      const v1 = await generate();
      // a leave in the week of 21 Dec
      const r = await applyRosterChange(prisma(), {
        rosterId: v1.roster.id,
        change: {
          type: "MAKE_UNAVAILABLE",
          employeeId: "emp-pooja-desai",
          fromDate: "2026-12-22",
          toDate: "2026-12-23",
        },
        actor: "tester",
      });
      expect(r.replannedWeeks).toEqual(["2026-12-21"]);
      const week = new Set(weeksOfMonth(DEC).find((w) => w.monday === "2026-12-21")!.fullWeek);

      const rows = (id: string) =>
        prisma().rosterEntry.findMany({
          where: { rosterId: id },
          orderBy: [{ employeeId: "asc" }, { date: "asc" }],
        });
      const [a, b] = [await rows(v1.roster.id), await rows(r.roster.id)];
      const pick = (e: (typeof a)[number]) => ({
        k: `${e.employeeId}|${e.date}`,
        status: e.status,
        cov: e.coveredBrandProcessIds,
        locked: e.locked,
        source: e.source,
      });
      const outside = (e: (typeof a)[number]) => !week.has(e.date);
      expect(b.filter(outside).map(pick)).toEqual(a.filter(outside).map(pick)); // identical, cell for cell
      expect(b.filter((e) => !outside(e)).map(pick)).not.toEqual(
        a.filter((e) => !outside(e)).map(pick),
      ); // and the week did change
      // in particular every weekly off outside that week is where it was
      const offs = (list: typeof a) =>
        list
          .filter((e) => e.status === "WEEKLY_OFF" && outside(e))
          .map((e) => `${e.employeeId}|${e.date}`);
      expect(offs(b)).toEqual(offs(a));
    });

    it("applying on a version that is no longer the latest is a CONFLICT and changes nothing", async () => {
      const a = await generate();
      await generate();
      const before = await counts();
      const e = await failure(
        applyRosterChange(prisma(), {
          rosterId: a.roster.id,
          change: {
            type: "MAKE_UNAVAILABLE",
            employeeId: AARAV,
            fromDate: "2026-12-08",
            toDate: "2026-12-08",
          },
        }),
      );
      expect(e.code).toBe("CONFLICT");
      expect(await counts()).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("acknowledge and publish", () => {
    it("publishing is BLOCKED while Ananya's 5 December errors are unacknowledged, and nothing changes", async () => {
      const { roster } = await generate();
      const before = await counts();
      const e = await failure(publishRoster(prisma(), { rosterId: roster.id, actor: "tester" }));
      expect(e.code).toBe("BLOCKED");
      expect(e.message).toContain("5 ERROR(s) block publishing");
      expect(e.details as unknown[]).toHaveLength(5);
      expect(
        (e.details as Array<{ employeeId: string }>).every((d) => d.employeeId === ANANYA),
      ).toBe(true);
      expect(await counts()).toEqual(before);
      const row = await prisma().roster.findUniqueOrThrow({ where: { id: roster.id } });
      expect(row).toMatchObject({ status: "DRAFT", publishedAt: null });
    });

    it("only a current ERROR can be acknowledged, and only with a real note", async () => {
      const { roster, issues } = await generate();
      const err = errorsOf(issues)[0];
      const warning = issues.find((i) => i.severity === "WARNING")!;
      const info = issues.find((i) => i.severity === "INFO")!;
      const base = { rosterId: roster.id, actor: "tester" };
      const before = await counts();

      for (const note of ["", "  ", "ok"]) {
        expect(
          (await failure(acknowledgeIssue(prisma(), { ...base, issueId: err.id, note }))).code,
        ).toBe("VALIDATION");
      }
      expect(
        (
          await failure(
            acknowledgeIssue(prisma(), {
              ...base,
              issueId: "WEEKLY_OFF_NOT_GRANTED:deadbeef",
              note: "looks fine",
            }),
          )
        ).code,
      ).toBe("NOT_FOUND");
      expect(
        (
          await failure(
            acknowledgeIssue(prisma(), { ...base, issueId: warning.id, note: "looks fine" }),
          )
        ).code,
      ).toBe("VALIDATION");
      expect(
        (
          await failure(
            acknowledgeIssue(prisma(), { ...base, issueId: info.id, note: "looks fine" }),
          )
        ).code,
      ).toBe("VALIDATION");
      expect(await counts()).toEqual(before);

      const ok = await acknowledgeIssue(prisma(), {
        ...base,
        issueId: err.id,
        note: "  Nimbus has no backup; accepted  ",
      });
      expect(ok).toMatchObject({
        issueId: err.id,
        note: "Nimbus has no backup; accepted",
        actor: "tester",
      });
      expect(
        (await prisma().auditLog.findFirstOrThrow({ where: { action: "ACK_ISSUE" } })).after,
      ).toMatchObject({ code: "WEEKLY_OFF_NOT_GRANTED", employeeId: ANANYA });
    });

    it("4 of 5 acknowledged is still blocked, naming the one left; acknowledging all 5 lets it publish", async () => {
      const { roster, issues } = await generate();
      const errs = errorsOf(issues);
      for (const e of errs.slice(0, 4))
        await acknowledgeIssue(prisma(), {
          rosterId: roster.id,
          issueId: e.id,
          note: "accepted: no backup",
        });

      const blocked = await failure(publishRoster(prisma(), { rosterId: roster.id }));
      expect(blocked.code).toBe("BLOCKED");
      expect(blocked.message).toContain("1 ERROR(s) block publishing");
      expect((blocked.details as Array<{ issueId: string }>)[0].issueId).toBe(errs[4].id);

      await acknowledgeIssue(prisma(), {
        rosterId: roster.id,
        issueId: errs[4].id,
        note: "accepted: no backup",
      });
      const credits = (await counts()).credits;
      const pub = await publishRoster(prisma(), { rosterId: roster.id, actor: "tester" });

      expect(pub.roster).toMatchObject({ status: "PUBLISHED", version: 1 });
      expect(pub.roster.publishedAt).not.toBeNull();
      expect(pub.acknowledgedErrors).toBe(5);
      expect(pub.compOffCreditsCreated).toBe(16); // 8 people each on 6 Dec and 25 Dec
      expect((await counts()).credits).toBe(credits + 16);
      expect(
        (await prisma().auditLog.findFirstOrThrow({ where: { action: "PUBLISH" } })).after,
      ).toMatchObject({ status: "PUBLISHED", acknowledgedErrors: 5, compOffCreditsCreated: 16 });
    });

    it("publishing checks the gate under the roster lock: an acknowledgement withdrawn while it waits still blocks it", async () => {
      const { roster } = await generate();
      await ackAll(roster.id); // publishable on the face of it
      const p = prisma();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const hasLock = new Promise<void>((r) => (locked = r));
      // another writer holds the roster's row lock and withdraws every acknowledgement before it lets go
      const other = p.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Roster" WHERE "id" = ${roster.id} FOR UPDATE`;
        locked();
        await gate;
        await tx.issueAck.deleteMany({ where: { rosterId: roster.id } });
      });
      await hasLock;
      let settled = false;
      const publishing = publishRoster(p, { rosterId: roster.id, actor: "tester" }).then(
        () => "published" as const,
        (e: unknown) => e as ServiceError,
      );
      void publishing.then(() => (settled = true));
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // it is waiting for the lock, not publishing on stale data
      release();
      await other;
      const outcome = await publishing;
      expect(outcome).not.toBe("published");
      expect((outcome as ServiceError).code).toBe("BLOCKED");
      expect((await p.roster.findUniqueOrThrow({ where: { id: roster.id } })).status).toBe("DRAFT");
    });

    it("an acknowledgement can be withdrawn, which blocks publishing again", async () => {
      const { roster } = await generate();
      await ackAll(roster.id);
      const view = await getRoster(prisma(), roster.id);
      expect(view.blockers).toEqual([]);
      await removeAcknowledgement(prisma(), roster.id, errorsOf(view.issues)[0].id, "tester");
      expect((await failure(publishRoster(prisma(), { rosterId: roster.id }))).code).toBe(
        "BLOCKED",
      );
      expect(
        (
          await failure(
            removeAcknowledgement(prisma(), roster.id, "WEEKLY_OFF_NOT_GRANTED:deadbeef"),
          )
        ).code,
      ).toBe("NOT_FOUND");
    });

    it("a NEW error appearing after acknowledgement blocks publishing until it is acknowledged too", async () => {
      const { roster } = await generate();
      await ackAll(roster.id);
      await saveManualEdit(prisma(), {
        rosterId: roster.id,
        employeeId: ISHITA,
        date: "2026-12-16",
        status: "WEEKLY_OFF",
        coveredBrandProcessIds: [],
        actor: "tester",
      });

      const e = await failure(publishRoster(prisma(), { rosterId: roster.id }));
      expect(e.code).toBe("BLOCKED");
      expect((e.details as unknown[]).length).toBe(2); // the two Coastal Candles gaps, not Ananya's five
      expect(e.message).toContain("Coastal Candles");
    });

    it("a published roster is final: publishing again, acknowledging and editing are all refused", async () => {
      const { roster } = await generate();
      await ackAll(roster.id);
      await publishRoster(prisma(), { rosterId: roster.id });
      const before = await counts();
      expect((await failure(publishRoster(prisma(), { rosterId: roster.id }))).code).toBe(
        "CONFLICT",
      );
      expect((await failure(removeAcknowledgement(prisma(), roster.id, "x"))).code).toBe(
        "CONFLICT",
      );
      expect(await counts()).toEqual(before);
    });

    it("changing a published roster creates a new DRAFT that carries the acknowledgements still in force", async () => {
      const v1 = await generate();
      await ackAll(v1.roster.id);
      await publishRoster(prisma(), { rosterId: v1.roster.id });

      const r = await applyRosterChange(prisma(), {
        rosterId: v1.roster.id,
        change: {
          type: "MAKE_UNAVAILABLE",
          employeeId: "emp-pooja-desai",
          fromDate: "2026-12-22",
          toDate: "2026-12-22",
        },
        actor: "tester",
      });
      expect(r.roster).toMatchObject({ version: 2, status: "DRAFT" });
      expect(r.carriedAcknowledgements).toBe(5); // Ananya's errors are still there, so their notes carry over
      expect(
        (await prisma().roster.findUniqueOrThrow({ where: { id: v1.roster.id } })).status,
      ).toBe("PUBLISHED"); // history intact
      const pub = await publishRoster(prisma(), { rosterId: r.roster.id, actor: "tester" });
      expect(pub.roster.version).toBe(2);
      // Re-planning the week of 21 Dec can change who works Christmas Day, so a new person may earn a new
      // credit, but nobody ever gets a duplicate, and every credit the roster earns exists.
      const rows = await prisma().compOffCredit.findMany();
      const keys = rows.map((c) => `${c.employeeId}|${c.earnedOn}`);
      expect(new Set(keys).size).toBe(keys.length);
      const earned = (await getRoster(prisma(), r.roster.id)).issues.filter(
        (i) => i.code === "COMP_OFF_EARNED",
      );
      for (const e of earned) expect(keys).toContain(`${e.employeeId}|${e.date}`);
      expect(pub.compOffCreditsCreated).toBeLessThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("the scripted gate run: generate -> edit -> simulate -> apply -> acknowledge -> publish", () => {
    it("works end to end, and every step is in the audit log", async () => {
      const log: string[] = [];
      const step = (s: string) => log.push(s);

      const v1 = await generate();
      step(
        `generate: v${v1.roster.version} ${v1.roster.status}, ${errorsOf(v1.issues).length} errors`,
      );

      const preview = await previewManualEdit(prisma(), {
        rosterId: v1.roster.id,
        employeeId: ISHITA,
        date: "2026-12-16",
        status: "WEEKLY_OFF",
        coveredBrandProcessIds: [],
        actor: "ops",
      });
      step(`edit preview: +${preview.delta.added.length} issues, nothing saved`);
      await saveManualEdit(prisma(), {
        rosterId: v1.roster.id,
        employeeId: ISHITA,
        date: "2026-12-16",
        status: "WEEKLY_OFF",
        coveredBrandProcessIds: [],
        actor: "ops",
      });
      const fix = await saveManualEdit(prisma(), {
        rosterId: v1.roster.id,
        employeeId: DIVYA,
        date: "2026-12-16",
        status: "WORK",
        coveredBrandProcessIds: [COASTAL_CS, COASTAL_ACC],
        actor: "ops",
      });
      step(
        `edit committed + fixed: ${fix.delta.resolved.length} gaps resolved, ${fix.errorsAfter} errors`,
      );

      const pending = await prisma().leave.findFirstOrThrow({ where: { status: "PENDING" } });
      const change = {
        type: "ADD_LEAVE" as const,
        leave: {
          id: pending.id,
          employeeId: pending.employeeId,
          fromDate: pending.fromDate,
          toDate: pending.toDate,
          type: pending.type,
          status: "APPROVED" as const,
        },
      };
      const sim = await simulateRosterChange(prisma(), { rosterId: v1.roster.id, change });
      step(
        `simulate: errors ${sim.errorsBefore} -> ${sim.errorsAfter}, ${sim.changedCells.length} cells, weeks ${sim.replannedWeeks.join(",")}`,
      );

      const applied = await applyRosterChange(prisma(), {
        rosterId: v1.roster.id,
        change,
        actor: "ops",
      });
      step(
        `apply: v${applied.roster.version} ${applied.roster.status}, parent v1, ${applied.carriedAcknowledgements} acks carried`,
      );

      await failure(publishRoster(prisma(), { rosterId: applied.roster.id, actor: "ops" }));
      step("publish (unacknowledged): BLOCKED");
      const n = await ackAll(applied.roster.id);
      step(`acknowledge: ${n} errors, each with a note`);
      const pub = await publishRoster(prisma(), { rosterId: applied.roster.id, actor: "ops" });
      step(
        `publish: v${pub.roster.version} ${pub.roster.status}, ${pub.compOffCreditsCreated} comp-off credits`,
      );

      console.log(`\nGATE RUN\n  ${log.join("\n  ")}\n`);

      const actions = (await prisma().auditLog.findMany({ orderBy: { createdAt: "asc" } })).map(
        (a) => a.action,
      );
      for (const a of ["GENERATE", "MANUAL_EDIT", "APPLY_CHANGE", "ACK_ISSUE", "PUBLISH"])
        expect(actions).toContain(a);
      expect(
        (await prisma().auditLog.findMany()).every(
          (a) => a.actor.length > 0 && a.entity.length > 0,
        ),
      ).toBe(true);
      expect(pub.roster).toMatchObject({
        version: 2,
        status: "PUBLISHED",
        parentVersionId: v1.roster.id,
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("master data and rosters", () => {
    it("a master-data change shows up in the existing roster through the same validator", async () => {
      const { roster } = await generate();
      // Ishita works on 16 Dec; approve a leave for her on that day
      await createRecord(
        prisma(),
        "leave",
        {
          employeeId: ISHITA,
          fromDate: "2026-12-16",
          toDate: "2026-12-16",
          type: "PLANNED",
          status: "APPROVED",
        },
        "ops",
      );
      const view = await getRoster(prisma(), roster.id);
      const bad = view.issues.find((i) => i.code === "WORK_WHILE_UNAVAILABLE");
      expect(bad).toMatchObject({ employeeId: ISHITA, date: "2026-12-16", severity: "ERROR" });
      // ... and the roster itself was not silently rewritten
      expect((await entryRow(roster.id, ISHITA, "2026-12-16")).status).toBe("WORK");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // P3 review round 1, findings 1 to 4.
  const JAN = "2027-01";
  const generateJan = () => generateMonth(prisma(), { month: JAN, actor: "tester" });
  const cellKey = (e: { employeeId: string; date: string }) => `${e.employeeId}|${e.date}`;

  /** Every cell both rosters hold must read the same in both views. Returns the shared cell count. */
  async function expectNoBoundaryDisagreement(decId: string, janId: string): Promise<number> {
    const [dec, jan] = await Promise.all([getRoster(prisma(), decId), getRoster(prisma(), janId)]);
    const janByKey = new Map(jan.entries.map((e) => [cellKey(e), e]));
    let shared = 0;
    for (const d of dec.entries) {
      const j = janByKey.get(cellKey(d));
      if (!j) continue;
      shared++;
      expect({ k: cellKey(d), status: j.status, covered: j.coveredBrandProcessIds }).toEqual({
        k: cellKey(d),
        status: d.status,
        covered: d.coveredBrandProcessIds,
      });
    }
    return shared;
  }

  describe("boundary week: December and January share 28 Dec to 3 Jan (review finding 1)", () => {
    const edit = (rosterId: string, employeeId: string, date: string, status = "WEEKLY_OFF") => ({
      rosterId,
      employeeId,
      date,
      status,
      coveredBrandProcessIds: [],
      actor: "tester",
    });

    it("a day that belongs to the neighbour month's existing roster cannot be edited here, in either direction, and nothing is written", async () => {
      const dec = await generate();
      const jan = await generateJan();
      const before = await counts();

      // January editing a December day (the reviewer's repro: Aarav on 29 Dec)
      for (const run of [previewManualEdit, saveManualEdit]) {
        const e = await failure(run(prisma(), edit(jan.roster.id, AARAV, "2026-12-29")));
        expect(e.code).toBe("CONFLICT");
        expect(e.message).toContain("belongs to the 2026-12 roster");
        expect(e.message).toContain("Edit it in the 2026-12 roster");
      }
      // December editing a January day (the other repro: Aarav's carried off on 3 Jan)
      for (const run of [previewManualEdit, saveManualEdit]) {
        const e = await failure(run(prisma(), edit(dec.roster.id, AARAV, "2027-01-03", "WORK")));
        expect(e.code).toBe("CONFLICT");
        expect(e.message).toContain("belongs to the 2027-01 roster");
      }
      expect(await counts()).toEqual(before);
    });

    it("until the neighbour has a roster, the spill day is provisional and may be edited (it is how December plans 3 Jan)", async () => {
      const dec = await generate();
      const c = await saveManualEdit(prisma(), edit(dec.roster.id, AARAV, "2027-01-03", "WORK"));
      expect(c.committed).toBe(true);
      expect((await entryRow(dec.roster.id, AARAV, "2027-01-03")).status).toBe("WORK");
    });

    it("an edit to a December-owned day shows in January at once, and after regenerating December; the two never disagree", async () => {
      const dec = await generate();
      const jan = await generateJan();
      expect(await expectNoBoundaryDisagreement(dec.roster.id, jan.roster.id)).toBeGreaterThan(100);

      await saveManualEdit(prisma(), edit(dec.roster.id, ISHITA, "2026-12-29"));
      // January's STORED copy is now out of date, but what January shows and validates is December's cell
      expect((await entryRow(jan.roster.id, ISHITA, "2026-12-29")).status).toBe("WORK");
      const janView = await getRoster(prisma(), jan.roster.id);
      expect(janView.entries.find((e) => cellKey(e) === `${ISHITA}|2026-12-29`)).toMatchObject({
        status: "WEEKLY_OFF",
        locked: true,
      });
      expect(janView.foreignDates["2026-12-29"]).toBe("2026-12");
      await expectNoBoundaryDisagreement(dec.roster.id, jan.roster.id);

      // regenerate December (v2): January follows the new latest version
      const dec2 = await generate();
      expect(dec2.roster.version).toBe(2);
      await expectNoBoundaryDisagreement(dec2.roster.id, jan.roster.id);
    });

    it("a neighbour roster created between the preview check and the commit still refuses the edit, and writes nothing", async () => {
      const dec = await generate(); // no January roster yet: 3 Jan is provisional and editable
      // Run the real service, but generate January just before its commit transaction starts.
      const p = prisma();
      let raced = false;
      const racing = new Proxy(p, {
        get(target, prop) {
          if (prop === "$transaction") {
            return async (fn: never, opts?: never) => {
              if (!raced) {
                raced = true;
                await generateJan();
              }
              return target.$transaction(fn, opts);
            };
          }
          const v = Reflect.get(target, prop, target);
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
      const e = await failure(
        saveManualEdit(racing, edit(dec.roster.id, AARAV, "2027-01-03", "WORK")),
      );
      expect(raced).toBe(true);
      expect(e.code).toBe("CONFLICT");
      expect(e.message).toContain("belongs to the 2027-01 roster");
      expect((await entryRow(dec.roster.id, AARAV, "2027-01-03")).status).not.toBe("WORK");
      expect(await p.auditLog.count({ where: { action: "MANUAL_EDIT" } })).toBe(0);
    });

    it("January working someone December owes an off to is a blocking ERROR in December, never a silent mismatch", async () => {
      const dec = await generate();
      const jan = await generateJan();
      await ackAll(dec.roster.id); // Ananya's five: December is publishable
      expect((await getRoster(prisma(), dec.roster.id)).blockers).toEqual([]);

      // Aarav's weekly off for the 28 Dec week is Sun 3 Jan (a January day): January now has him working
      await saveManualEdit(prisma(), edit(jan.roster.id, AARAV, "2027-01-03", "WORK"));

      const decView = await getRoster(prisma(), dec.roster.id);
      expect(decView.entries.find((e) => cellKey(e) === `${AARAV}|2027-01-03`)?.status).toBe(
        "WORK",
      );
      const gap = decView.issues.find(
        (i) => i.code === "WEEKLY_OFF_NOT_GRANTED" && i.employeeId === AARAV,
      );
      expect(gap).toBeDefined();
      expect(decView.blockers.map((b) => b.id)).toEqual([gap!.id]);
      const blocked = await failure(publishRoster(prisma(), { rosterId: dec.roster.id }));
      expect(blocked.code).toBe("BLOCKED");
      expect(blocked.message).toContain("1 ERROR(s) block publishing");
      expect(
        (await prisma().roster.findUniqueOrThrow({ where: { id: dec.roster.id } })).status,
      ).toBe("DRAFT");
    });
  });

  describe("a change that falls in another month's days (review finding 2)", () => {
    const leave = (fromDate: string, toDate: string) => ({
      type: "ADD_LEAVE" as const,
      leave: {
        employeeId: DIVYA,
        fromDate,
        toDate,
        type: "PLANNED" as const,
        status: "APPROVED" as const,
      },
    });

    it("is refused from the roster that does not own those days, by preview and by apply, and saves nothing", async () => {
      await generate();
      const jan = await generateJan();
      const before = await counts();
      const sim = await failure(
        simulateRosterChange(prisma(), {
          rosterId: jan.roster.id,
          change: leave("2026-12-30", "2026-12-31"),
        }),
      );
      expect(sim.code).toBe("CONFLICT");
      expect(sim.message).toContain("belongs to the 2026-12 roster, not 2027-01");
      expect(sim.message).toContain("Apply it from the 2026-12 roster");
      const app = await failure(
        applyRosterChange(prisma(), {
          rosterId: jan.roster.id,
          change: leave("2026-12-30", "2026-12-31"),
          actor: "tester",
        }),
      );
      expect(app.code).toBe("CONFLICT");
      // a one-day override on a December date is date-bound too
      const ov = await failure(
        applyRosterChange(prisma(), {
          rosterId: jan.roster.id,
          change: {
            type: "CHANGE_MIN_STAFF",
            brandProcessId: COASTAL_CS,
            override: { date: "2026-12-30", minStaff: 2 },
          },
          actor: "tester",
        }),
      );
      expect(ov.code).toBe("CONFLICT");
      expect(await counts()).toEqual(before); // no leave, no version, no audit row
    });

    it("a change that straddles two months is allowed, names the other month, and that month's validator flags what it breaks", async () => {
      const dec = await generate();
      const jan = await generateJan();
      const change = leave("2026-12-30", "2027-01-02");

      const sim = await simulateRosterChange(prisma(), { rosterId: jan.roster.id, change });
      expect(sim.affectedMonths).toEqual(["2026-12"]);
      const fromDec = await simulateRosterChange(prisma(), { rosterId: dec.roster.id, change });
      expect(fromDec.affectedMonths).toEqual([JAN]);

      const applied = await applyRosterChange(prisma(), {
        rosterId: jan.roster.id,
        change,
        actor: "tester",
      });
      expect(applied.affectedMonths).toEqual(["2026-12"]);
      expect(applied.roster.version).toBe(2);
      const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: "APPLY_CHANGE" } });
      expect(audit.after).toMatchObject({ alsoAffectsMonths: ["2026-12"] });
      // December was NOT re-planned (still v1), and it is not silent: Divya is flagged working on leave
      expect((await listRosterVersions(prisma(), "2026-12")).length).toBe(1);
      const decView = await getRoster(prisma(), dec.roster.id);
      expect(
        decView.issues.some((i) => i.code === "WORK_WHILE_UNAVAILABLE" && i.employeeId === DIVYA),
      ).toBe(true);
    });

    it("a rule-wide change (no dates) is not refused from either month", async () => {
      await generate();
      const jan = await generateJan();
      const sim = await simulateRosterChange(prisma(), {
        rosterId: jan.roster.id,
        change: { type: "CHANGE_MIN_STAFF", brandProcessId: COASTAL_CS, defaultMinStaff: 1 },
      });
      expect(sim.affectedMonths).toEqual([]);
    });
  });

  describe("acknowledgements are tied to the wording of the issue (review finding 3)", () => {
    it("a gap acknowledged as it was stops counting once the same issue reads worse, in the same version and after regenerating", async () => {
      const { roster } = await generate();
      await saveManualEdit(prisma(), {
        rosterId: roster.id,
        employeeId: ISHITA,
        date: "2026-12-16",
        status: "WEEKLY_OFF",
        coveredBrandProcessIds: [],
        actor: "tester",
      });
      await ackAll(roster.id);
      expect((await getRoster(prisma(), roster.id)).blockers).toEqual([]);
      const gapBefore = (await getRoster(prisma(), roster.id)).issues.find(
        (i) => i.code === "COVERAGE_GAP" && i.brandProcessId === COASTAL_CS,
      )!;
      expect(gapBefore.acknowledgement).not.toBeNull();

      // the client now needs two people that day: same issue id, worse message
      await createRecord(
        prisma(),
        "coverageOverride",
        { brandProcessId: COASTAL_CS, date: "2026-12-16", minStaff: 2 },
        "ops",
      );
      const view = await getRoster(prisma(), roster.id);
      const gapAfter = view.issues.find(
        (i) => i.code === "COVERAGE_GAP" && i.brandProcessId === COASTAL_CS,
      )!;
      expect(gapAfter.id).toBe(gapBefore.id);
      expect(gapAfter.message).not.toBe(gapBefore.message);
      expect(gapAfter.acknowledgement).toBeNull();
      expect(gapAfter.changedSince).toMatchObject({
        previousMessage: gapBefore.message,
        note: "Accepted for the demo: no backup exists",
      });
      expect(view.blockers.map((b) => b.id)).toEqual([gapAfter.id]);
      expect((await failure(publishRoster(prisma(), { rosterId: roster.id }))).code).toBe(
        "BLOCKED",
      );

      // regenerating keeps the manual edit, so the worse gap carries as "changed since", not as acknowledged
      const v2 = await generate();
      expect(v2.changedSinceAcknowledged).toBe(1);
      // Ananya's five carry unchanged. Coastal ACC's gap is gone (the regenerate lets a backup cover it), so nothing
      // is carried for it; only the CS gap, whose wording changed, is copied as "changed since".
      expect(v2.carriedAcknowledgements).toBe(5);
      const v2View = await getRoster(prisma(), v2.roster.id);
      expect(v2View.blockers.map((b) => b.id)).toEqual([gapAfter.id]);
      expect(v2View.issues.find((i) => i.id === gapAfter.id)?.changedSince?.previousMessage).toBe(
        gapBefore.message,
      );

      // acknowledging the new wording clears it
      await acknowledgeIssue(prisma(), {
        rosterId: v2.roster.id,
        issueId: gapAfter.id,
        note: "Client agreed to a thin day",
        actor: "tester",
      });
      expect((await getRoster(prisma(), v2.roster.id)).blockers).toEqual([]);
    });
  });

  describe("comp-off credits follow the published version (review finding 4)", () => {
    const creditsFor = () =>
      prisma().compOffCredit.findMany({ orderBy: [{ employeeId: "asc" }, { earnedOn: "asc" }] });
    // a hand-entered credit for someone who is on HOLIDAY (not working) on 25 Dec, so a careless retract would take it

    it("publishing v2 retracts an unused credit v1 created and v2 no longer earns, and keeps used and hand-entered ones", async () => {
      const v1 = await generate();
      await ackAll(v1.roster.id);
      const offDuty = (await getRoster(prisma(), v1.roster.id)).entries.find(
        (e) => e.date === "2026-12-25" && e.status === "HOLIDAY",
      )!;
      const manual = await createRecord(
        prisma(),
        "compOffCredit",
        { employeeId: offDuty.employeeId, earnedOn: "2026-12-25", reason: "entered by hand" },
        "ops",
      );
      const pub1 = await publishRoster(prisma(), { rosterId: v1.roster.id, actor: "tester" });
      expect(pub1.compOffCreditsRetracted).toBe(0);

      // who works Christmas Day (25 Dec) in v1, with an auto credit
      const autoXmas = (await creditsFor()).filter(
        (c) => c.earnedOn === "2026-12-25" && c.publishedByRosterId === v1.roster.id,
      );
      expect(autoXmas.length).toBeGreaterThan(1);
      const [dropped, used, kept] = autoXmas;
      // one has used theirs
      await prisma().compOffCredit.update({
        where: { id: used.id },
        data: { usedOn: "2027-01-12" },
      });

      // v2: take the "dropped" and "used" people off Christmas Day (a manual leave day), still a DRAFT
      const v2 = await generate();
      for (const c of [dropped, used]) {
        await saveManualEdit(prisma(), {
          rosterId: v2.roster.id,
          employeeId: c.employeeId,
          date: "2026-12-25",
          status: "HOLIDAY",
          coveredBrandProcessIds: [],
          actor: "tester",
        });
      }
      await ackAll(v2.roster.id);
      const pub2 = await publishRoster(prisma(), { rosterId: v2.roster.id, actor: "tester" });

      const after = await creditsFor();
      const has = (id: string) => after.some((c) => c.id === id);
      expect(has(dropped.id)).toBe(false); // no longer earned, never used: retracted
      expect(has(used.id)).toBe(true); // already used: stays
      expect(has(kept.id)).toBe(true); // still earned
      expect(has(manual.id)).toBe(true); // entered by a manager, never touched
      expect(pub2.compOffCreditsRetracted).toBe(1);
      expect(pub2.compOffCreditsKeptUsed).toBe(1);
      expect(
        (
          await prisma().auditLog.findFirstOrThrow({
            where: { action: "PUBLISH", rosterId: v2.roster.id },
          })
        ).after,
      ).toMatchObject({ compOffCreditsRetracted: 1, compOffCreditsKeptUsed: 1 });
    });
  });
});
