// The passcode lock on every server action, against a real Postgres.
//
// The rule: an action either appears in PUBLIC_ACTIONS (read-only, or a preview that writes nothing) or it is
// refused with UNAUTHORIZED when there is no session, and writes nothing. The list of actions comes from the
// modules' real exports, so a new action that forgets the guard fails here without anyone editing this test.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from "../auth/session";
import { generateMonth } from "../services/roster";
import { DEC, HAS_DB, closeDb, resetDb, testPrisma } from "./helpers";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// The actions import the app's own client; point it at the test database (the tests wipe what they use).
vi.mock("../db", async () => ({ prisma: (await import("./helpers")).testPrisma() }));

const SECRET = "s".repeat(40);
const session = (name: string, exp = Date.now() + SESSION_TTL_MS) =>
  signSession({ name, exp }, SECRET);

/** Read-only actions and previews that write nothing. Everything else exported by an actions module must be guarded. */
const PUBLIC_ACTIONS = new Set([
  "listRecordsAction",
  "getRecordAction",
  "getRosterAction",
  "listRosterVersionsAction",
  "previewEditAction",
  "previewSuggestionAction",
  "simulateChangeAction",
]);

async function actionModules() {
  const [master, roster] = await Promise.all([
    import("../actions/master"),
    import("../actions/roster"),
  ]);
  const all: [string, (...a: unknown[]) => Promise<{ ok: boolean; error?: { code: string } }>][] =
    [];
  for (const mod of [master, roster])
    for (const [name, fn] of Object.entries(mod))
      if (typeof fn === "function") all.push([name, fn as never]);
  return all;
}

async function rowCounts() {
  const p = testPrisma();
  const counts = await Promise.all([
    p.auditLog.count(),
    p.roster.count(),
    p.rosterEntry.count(),
    p.issueAck.count(),
    p.podApproval.count(),
    p.employee.count(),
    p.pod.count(),
    p.brand.count(),
    p.process.count(),
    p.brandProcess.count(),
    p.assignment.count(),
    p.publicHoliday.count(),
    p.leave.count(),
    p.compOffCredit.count(),
    p.coverageOverride.count(),
  ]);
  return counts.join(",");
}

describe.skipIf(!HAS_DB)("server actions are behind the passcode session", () => {
  beforeAll(() => {
    process.env.DEMO_PASSCODE = "open sesame";
    process.env.SESSION_SECRET = SECRET;
  });
  beforeEach(async () => {
    jar.clear();
    await resetDb();
  });
  afterAll(closeDb);

  it("finds the actions (guards against this test silently checking nothing)", async () => {
    const names = (await actionModules()).map(([n]) => n);
    expect(names.length).toBeGreaterThanOrEqual(19);
    for (const p of PUBLIC_ACTIONS) expect(names).toContain(p);
  });

  it("every action not on the public list refuses with UNAUTHORIZED and writes nothing", async () => {
    const before = await rowCounts();
    const guarded = (await actionModules()).filter(([n]) => !PUBLIC_ACTIONS.has(n));
    expect(guarded.length).toBeGreaterThanOrEqual(12);
    for (const [name, fn] of guarded) {
      // Plausible arguments so that, were the guard missing, the call would get past validation and write.
      const args = [
        { rosterId: "x", month: DEC, podId: "x", issueId: "x", note: "n", actor: "evil" },
        { rosterId: "x", month: DEC, podId: "x", issueId: "x", note: "n", actor: "evil" },
        "evil",
      ];
      const r = await fn(...args);
      expect(r.ok, name).toBe(false);
      expect(r.error?.code, name).toBe("UNAUTHORIZED");
    }
    expect(await rowCounts()).toBe(before);
  });

  it("refuses with a forged cookie, an expired cookie and a cookie signed with another secret", async () => {
    const before = await rowCounts();
    const { generateRosterAction } = await import("../actions/roster");
    for (const value of [
      "forged.value",
      session("Asha", Date.now() - 1000),
      signSession({ name: "Asha", exp: Date.now() + 1e9 }, "y".repeat(40)),
    ]) {
      jar.set(SESSION_COOKIE, value);
      const r = await generateRosterAction({ month: "2027-02", actor: "Asha" });
      expect(r).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    }
    expect(await rowCounts()).toBe(before);
  });

  it("fails closed when the passcode is not configured, even with a validly signed cookie", async () => {
    const { generateRosterAction } = await import("../actions/roster");
    jar.set(SESSION_COOKIE, session("Asha"));
    const saved = process.env.DEMO_PASSCODE;
    delete process.env.DEMO_PASSCODE;
    try {
      const r = await generateRosterAction({ month: "2027-02" });
      expect(r).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    } finally {
      process.env.DEMO_PASSCODE = saved;
    }
  });

  it("public actions still work with no session", async () => {
    const { listRecordsAction } = await import("../actions/master");
    const { listRosterVersionsAction } = await import("../actions/roster");
    expect((await listRecordsAction("pod")).ok).toBe(true);
    expect((await listRosterVersionsAction(DEC)).ok).toBe(true);
  });

  it("with a session the action runs, and the audit actor is the session's name, not the client's", async () => {
    const p = testPrisma();
    const { approvePodAction } = await import("../actions/roster");
    const { roster } = await generateMonth(p, { month: DEC, actor: "setup" });
    const pod = await p.pod.findFirstOrThrow({
      where: { employees: { some: { isActive: true } } },
    });
    jar.set(SESSION_COOKIE, session("Asha Rao"));

    const r = await approvePodAction({ rosterId: roster.id, podId: pod.id, actor: "someone else" });
    expect(r.ok).toBe(true);

    const approval = await p.podApproval.findFirstOrThrow({
      where: { rosterId: roster.id, podId: pod.id },
    });
    expect(approval.approvedBy).toBe("Asha Rao");
    const audit = await p.auditLog.findFirstOrThrow({
      where: { rosterId: roster.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.actor).toBe("Asha Rao");
    expect(await p.auditLog.count({ where: { actor: "someone else" } })).toBe(0);
    expect(await p.auditLog.count({ where: { actor: "Asha Rao", action: "APPROVE_POD" } })).toBe(1);
  });

  it("master-data writes are audited under the session name", async () => {
    const p = testPrisma();
    const { createRecordAction } = await import("../actions/master");
    jar.set(SESSION_COOKIE, session("Asha Rao"));
    const r = await createRecordAction("holiday", { date: "2026-12-31", name: "Test day" });
    expect(r.ok).toBe(true);
    expect(await p.auditLog.count({ where: { actor: "Asha Rao", entity: "PublicHoliday" } })).toBe(
      1,
    );
  });
});
