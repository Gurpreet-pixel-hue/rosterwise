// Integration tests for what the P4 UI relies on: the coverage table, the neighbour-impact preview of an edit,
// and applying a suggestion through the one validated edit path. Real Postgres (TEST_DATABASE_URL).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Issue } from "../../engine/types";
import { ServiceError } from "../errors";
import {
  applySuggestionToRoster,
  editCells,
  generateMonth,
  getRoster,
  saveManualEdit,
} from "../services/roster";
import { loadRosterPage } from "../pageData";
import { DEC, HAS_DB, closeDb, resetDb, testPrisma } from "./helpers";

const ISHITA = "emp-ishita-verma";
const DIVYA = "emp-divya-menon";
const RAHUL = "emp-rahul-bhatt";
const AARAV = "emp-aarav-sharma";
const COASTAL_CS = "bp-coastal-candles-cs";
const JAN = "2027-01";
const prisma = () => testPrisma();

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
  const [entries, audits, assignments, rosters] = await Promise.all([
    p.rosterEntry.count(),
    p.auditLog.count(),
    p.assignment.count(),
    p.roster.count(),
  ]);
  return { entries, audits, assignments, rosters };
};

const gen = (month: string) => generateMonth(prisma(), { month, actor: "tester" });
const sendIshitaOff = (rosterId: string) =>
  saveManualEdit(prisma(), {
    rosterId,
    employeeId: ISHITA,
    date: "2026-12-16",
    status: "WEEKLY_OFF",
    coveredBrandProcessIds: [],
    actor: "tester",
  });

async function csGap(
  rosterId: string,
): Promise<{ issue: Issue; view: Awaited<ReturnType<typeof getRoster>> }> {
  const view = await getRoster(prisma(), rosterId, { suggestions: true });
  const issue = view.issues.find(
    (i) => i.code === "COVERAGE_GAP" && i.brandProcessId === COASTAL_CS && i.date === "2026-12-16",
  );
  if (!issue) throw new Error("expected the Coastal Candles / CS gap on 16 Dec");
  return { issue, view };
}

describe.skipIf(!HAS_DB)("what the P4 UI relies on (integration, real Postgres)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  describe("coverage strip data", () => {
    it("a brand-process/day is short in the strip exactly when the validator reports a COVERAGE_GAP, in December after an edit and in January", async () => {
      const dec = await gen(DEC);
      const jan = await gen(JAN);
      await sendIshitaOff(dec.roster.id);
      await saveManualEdit(prisma(), {
        rosterId: jan.roster.id,
        employeeId: ISHITA,
        date: "2027-01-12",
        status: "WEEKLY_OFF",
        coveredBrandProcessIds: [],
        actor: "tester",
      });
      let shortCells = 0;
      for (const [id, month] of [
        [dec.roster.id, DEC],
        [jan.roster.id, JAN],
      ] as const) {
        const view = await getRoster(prisma(), id);
        const gaps = new Set(
          view.issues
            .filter((i) => i.code === "COVERAGE_GAP")
            .map((i) => `${i.brandProcessId}|${i.date}`),
        );
        const short = new Set<string>();
        for (const [bp, days] of Object.entries(view.coverage)) {
          for (const [date, c] of Object.entries(days)) {
            expect(date.startsWith(month)).toBe(true); // in-month dates only
            if (c.required > 0 && c.covering < c.required) short.add(`${bp}|${date}`);
            expect(c.coverers.length).toBe(c.covering);
          }
        }
        expect(short).toEqual(gaps);
        shortCells += short.size;
      }
      expect(shortCells).toBe(4); // Ishita's two Coastal gaps in each month were really compared
    });

    it("the page loader returns the latest view with refs, window and months, and null before generation", async () => {
      const empty = await loadRosterPage(prisma(), DEC);
      expect(empty.view).toBeNull();
      expect(empty.versions).toEqual([]);
      expect(empty.refs.employees.length).toBe(32);
      expect(empty.window.length).toBe(35);
      expect(empty.monthDates.length).toBe(31);

      await gen(DEC);
      const page = await loadRosterPage(prisma(), DEC);
      expect(page.view?.roster.version).toBe(1);
      expect(page.view?.coverage[COASTAL_CS]["2026-12-16"]).toMatchObject({
        required: 1,
        covering: 1,
      });
      expect(Object.keys(page.view!.explanations).length).toBe(page.view!.issues.length);
      // backup recommendations ride along: Nimbus is exposed, Coastal is covered
      expect(page.backups.length).toBe(34);
      expect(
        page.backups.find((b) => b.brandName === "Nimbus Gadgets" && b.processCode === "CS")
          ?.status,
      ).toBe("EXPOSED");
      expect(
        page.backups.find((b) => b.brandName === "Coastal Candles" && b.processCode === "CS")
          ?.status,
      ).toBe("COVERED_BY_BACKUP");
    });
  });

  describe("an edit shows what it does to the neighbouring month before saving", () => {
    const aaravOnSunday = (rosterId: string) => ({
      rosterId,
      employeeId: AARAV,
      date: "2027-01-03",
      status: "WORK" as const,
      coveredBrandProcessIds: [] as string[],
      actor: "tester",
    });

    it("January working Aarav on 3 Jan reports a new WEEKLY_OFF_NOT_GRANTED in December, nothing saved by the preview", async () => {
      await gen(DEC);
      const jan = await gen(JAN);
      const before = await counts();
      const preview = await editCells(
        prisma(),
        { ...aaravOnSunday(jan.roster.id), edits: [aaravOnSunday(jan.roster.id)] },
        { commit: false },
      );
      expect(preview.committed).toBe(false);
      expect(preview.neighbourImpact?.month).toBe(DEC);
      expect(preview.neighbourImpact?.added.map((i) => `${i.code}|${i.employeeId}`)).toContain(
        `WEEKLY_OFF_NOT_GRANTED|${AARAV}`,
      );
      expect(await counts()).toEqual(before);

      // and it is true: after committing, December really has that ERROR
      const committed = await editCells(
        prisma(),
        { ...aaravOnSunday(jan.roster.id), edits: [aaravOnSunday(jan.roster.id)] },
        { commit: true },
      );
      expect(committed.neighbourImpact?.added.length).toBeGreaterThan(0);
      const decView = await getRoster(
        prisma(),
        (await prisma().roster.findFirstOrThrow({ where: { month: DEC } })).id,
      );
      expect(
        decView.issues.some((i) => i.code === "WEEKLY_OFF_NOT_GRANTED" && i.employeeId === AARAV),
      ).toBe(true);
    });

    it("an edit nobody else sees reports no neighbour impact", async () => {
      await gen(DEC);
      const jan = await gen(JAN);
      const r = await editCells(
        prisma(),
        {
          rosterId: jan.roster.id,
          actor: "tester",
          edits: [
            {
              employeeId: ISHITA,
              date: "2027-01-12",
              status: "WEEKLY_OFF",
              coveredBrandProcessIds: [],
            },
          ],
        },
        { commit: false },
      );
      expect(r.neighbourImpact).toBeNull();
    });
  });

  describe("applying a suggestion", () => {
    const pick = (issue: Issue, type: string, employeeId?: string) =>
      issue.suggestions.findIndex(
        (s) => s.type === type && (!employeeId || s.employeeId === employeeId),
      );

    it("USE_BACKUP: the preview writes nothing; applying fixes the gap through the validated edit path and is audited", async () => {
      const { roster } = await gen(DEC);
      await sendIshitaOff(roster.id);
      const { issue } = await csGap(roster.id);
      const idx = pick(issue, "USE_BACKUP", DIVYA);
      expect(idx).toBeGreaterThanOrEqual(0);
      const req = { rosterId: roster.id, issueId: issue.id, suggestionIndex: idx, actor: "tester" };

      const before = await counts();
      const preview = await applySuggestionToRoster(prisma(), req, { commit: false });
      expect(preview.committed).toBe(false);
      expect(preview.delta.resolved.map((i) => i.id)).toContain(issue.id);
      expect(await counts()).toEqual(before);

      const done = await applySuggestionToRoster(prisma(), req, { commit: true });
      expect(done.committed).toBe(true);
      expect(done.errorsAfter).toBeLessThan(done.errorsBefore);
      const after = await getRoster(prisma(), roster.id);
      expect(after.issues.some((i) => i.id === issue.id)).toBe(false);
      const divya = after.entries.find((e) => e.employeeId === DIVYA && e.date === "2026-12-16")!;
      expect(divya).toMatchObject({ status: "WORK", locked: true, source: "MANUAL" });
      expect(divya.coveredBrandProcessIds).toContain(COASTAL_CS);
      const audit = await prisma().auditLog.findFirstOrThrow({
        where: { action: "MANUAL_EDIT", entityId: `${DIVYA}|2026-12-16` },
      });
      expect(audit.after).toMatchObject({ via: "suggestion USE_BACKUP for COVERAGE_GAP" });
    });

    it("REASSIGN_FROM_POD creates the temporary assignment and the cell edit together, atomically", async () => {
      const { roster } = await gen(DEC);
      await sendIshitaOff(roster.id);
      const { issue } = await csGap(roster.id);
      const idx = pick(issue, "REASSIGN_FROM_POD", RAHUL);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(
        await prisma().assignment.count({
          where: { employeeId: RAHUL, brandProcessId: COASTAL_CS },
        }),
      ).toBe(0);

      const done = await applySuggestionToRoster(
        prisma(),
        { rosterId: roster.id, issueId: issue.id, suggestionIndex: idx, actor: "tester" },
        { commit: true },
      );
      expect(done.assignmentsCreated).toBeGreaterThan(0);
      const created = await prisma().assignment.findFirstOrThrow({
        where: { employeeId: RAHUL, brandProcessId: COASTAL_CS },
      });
      expect(created.role).toBe("BACKUP");
      expect(created.note).toContain("Added from roster 2026-12 v1");
      expect(created.note).toContain("suggestion REASSIGN_FROM_POD");
      expect(
        await prisma().assignment.count({
          where: { employeeId: RAHUL, brandProcessId: COASTAL_CS },
        }),
      ).toBe(1);
      const after = await getRoster(prisma(), roster.id);
      expect(after.issues.some((i) => i.id === issue.id)).toBe(false);
      expect(
        await prisma().auditLog.count({ where: { action: "CREATE", entity: "Assignment" } }),
      ).toBeGreaterThan(0);
    });

    it("refuses ACCEPT_GAP, a vanished issue and a bad suggestion number, and saves nothing", async () => {
      const { roster } = await gen(DEC);
      await sendIshitaOff(roster.id);
      const { issue } = await csGap(roster.id);
      const before = await counts();
      const accept = await failure(
        applySuggestionToRoster(
          prisma(),
          {
            rosterId: roster.id,
            issueId: issue.id,
            suggestionIndex: pick(issue, "ACCEPT_GAP"),
            actor: "t",
          },
          { commit: true },
        ),
      );
      expect(accept.code).toBe("VALIDATION");
      expect(accept.message).toContain("acknowledge the issue");
      expect(
        (
          await failure(
            applySuggestionToRoster(
              prisma(),
              { rosterId: roster.id, issueId: "COVERAGE_GAP:nope", suggestionIndex: 0, actor: "t" },
              { commit: true },
            ),
          )
        ).code,
      ).toBe("NOT_FOUND");
      expect(
        (
          await failure(
            applySuggestionToRoster(
              prisma(),
              { rosterId: roster.id, issueId: issue.id, suggestionIndex: 19, actor: "t" },
              { commit: true },
            ),
          )
        ).code,
      ).toBe("NOT_FOUND");
      expect(await counts()).toEqual(before);
    });
  });

  describe("a multi-cell edit is all or nothing", () => {
    it("one bad cell (unknown brand-process) saves none of them; the same cell twice is refused", async () => {
      const { roster } = await gen(DEC);
      const before = await counts();
      const ok = {
        employeeId: ISHITA,
        date: "2026-12-17",
        status: "WEEKLY_OFF" as const,
        coveredBrandProcessIds: [],
      };
      const bad = {
        employeeId: DIVYA,
        date: "2026-12-17",
        status: "WORK" as const,
        coveredBrandProcessIds: ["bp-nope"],
      };
      const e1 = await failure(
        editCells(
          prisma(),
          { rosterId: roster.id, actor: "t", edits: [ok, bad] },
          { commit: true },
        ),
      );
      expect(e1.code).toBe("VALIDATION");
      const e2 = await failure(
        editCells(prisma(), { rosterId: roster.id, actor: "t", edits: [ok, ok] }, { commit: true }),
      );
      expect(e2.message).toContain("same cell appears twice");
      expect(await counts()).toEqual(before);
      expect(
        (
          await prisma().rosterEntry.findFirstOrThrow({
            where: { rosterId: roster.id, employeeId: ISHITA, date: "2026-12-17" },
          })
        ).status,
      ).toBe("WORK");
    });
  });
});
