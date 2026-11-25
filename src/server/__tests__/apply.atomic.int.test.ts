// Atomicity of applyRosterChange against a real Postgres. The loader is stubbed to claim that a leave
// exists which the database does not have, so a REMOVE_LEAVE of it passes validation AND the engine
// simulation, and only fails at the very last step of the transaction, after the new roster version and
// all of its entries have been inserted. Everything must then be rolled back.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../loadEngineInput", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../loadEngineInput")>();
  return {
    ...actual,
    loadEngineInput: async (...args: Parameters<typeof actual.loadEngineInput>) => {
      const input = await actual.loadEngineInput(...args);
      return {
        ...input,
        leaves: [
          ...input.leaves,
          // REJECTED, so it has no effect on any roster; it only exists in the stubbed view
          {
            id: "ghost-leave",
            employeeId: "emp-aarav-sharma",
            fromDate: "2026-12-08",
            toDate: "2026-12-08",
            type: "PLANNED" as const,
            status: "REJECTED" as const,
          },
        ],
      };
    },
  };
});

import { ServiceError } from "../errors";
import { applyRosterChange, generateMonth, listRosterVersions } from "../services/roster";
import { DEC, HAS_DB, closeDb, resetDb, testPrisma } from "./helpers";

describe.skipIf(!HAS_DB)("applyRosterChange is atomic (integration, real Postgres)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(closeDb);

  it("a failure at the end of the transaction rolls back the new version, its entries, and the audit row", async () => {
    const prisma = testPrisma();
    const v1 = await generateMonth(prisma, { month: DEC, actor: "tester" });
    const snapshot = async () => ({
      rosters: await prisma.roster.count(),
      entries: await prisma.rosterEntry.count(),
      leaves: await prisma.leave.count(),
      audits: await prisma.auditLog.count(),
    });
    const before = await snapshot();
    expect(before.entries).toBe(32 * 35);

    let error: unknown;
    try {
      await applyRosterChange(prisma, {
        rosterId: v1.roster.id,
        change: { type: "REMOVE_LEAVE", leaveId: "ghost-leave" },
        actor: "tester",
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe("VALIDATION");
    expect((error as ServiceError).message).toContain("Nothing was saved");
    expect(await snapshot()).toEqual(before); // the 1,120 new entries and the new roster are gone again
    expect((await listRosterVersions(prisma, DEC)).map((v) => v.version)).toEqual([1]);
  });
});
