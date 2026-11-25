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
});
