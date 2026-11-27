// Pod-lead approval (P5.6), against a real Postgres.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../errors";
import { approvePod, revokePodApproval } from "../services/approval";
import {
  acknowledgeIssue,
  generateMonth,
  getRoster,
  publishRoster,
  saveManualEdit,
} from "../services/roster";
import { DEC, HAS_DB, closeDb, resetDb, testPrisma } from "./helpers";

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

const pods = async () => {
  const rows = await prisma().pod.findMany({ orderBy: { name: "asc" } });
  return Object.fromEntries(rows.map((p) => [p.name, p.id])) as Record<string, string>;
};
const approve = (rosterId: string, podId: string, actor = "lead") =>
  approvePod(prisma(), { rosterId, podId, actor });

async function ackAll(rosterId: string) {
  const view = await getRoster(prisma(), rosterId);
  for (const e of view.issues.filter((i) => i.severity === "ERROR"))
    await acknowledgeIssue(prisma(), {
      rosterId,
      issueId: e.id,
      note: "accepted for the test",
      actor: "t",
    });
}

describe.skipIf(!HAS_DB)("pod-lead approval (integration, real Postgres)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a pod is approved and withdrawn on a draft, shows in the roster view, and is audited", async () => {
    const { roster } = await generateMonth(prisma(), { month: DEC, actor: "t" });
    const P = await pods();
    const a = await approvePod(prisma(), {
      rosterId: roster.id,
      podId: P.Alpha,
      actor: "Nisha",
      note: "looks right",
    });
    expect(a).toMatchObject({ podId: P.Alpha, approvedBy: "Nisha", note: "looks right" });

    const view = await getRoster(prisma(), roster.id);
    expect(view.podApprovals.map((x) => x.podId)).toEqual([P.Alpha]);
    expect(view.requirePodApprovals).toBe(false); // off unless REQUIRE_POD_APPROVAL is set

    await revokePodApproval(prisma(), { rosterId: roster.id, podId: P.Alpha, actor: "Nisha" });
    expect((await getRoster(prisma(), roster.id)).podApprovals).toEqual([]);
    const actions = (await prisma().auditLog.findMany({ orderBy: { createdAt: "asc" } })).map(
      (l) => l.action,
    );
    expect(actions).toContain("APPROVE_POD");
    expect(actions).toContain("REVOKE_POD_APPROVAL");
    expect(
      (
        await failure(
          revokePodApproval(prisma(), { rosterId: roster.id, podId: P.Alpha, actor: "x" }),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });

  it("refuses an unknown pod, an older version and a published roster, and writes nothing", async () => {
    const v1 = await generateMonth(prisma(), { month: DEC, actor: "t" });
    const P = await pods();
    expect((await failure(approve(v1.roster.id, "pod-nope"))).code).toBe("NOT_FOUND");

    await ackAll(v1.roster.id);
    await publishRoster(
      prisma(),
      { rosterId: v1.roster.id, actor: "t" },
      { requirePodApprovals: false },
    );
    const onPublished = await failure(approve(v1.roster.id, P.Alpha));
    expect(onPublished.code).toBe("CONFLICT");
    expect(onPublished.message).toContain("published");

    const v2 = await generateMonth(prisma(), { month: DEC, actor: "t" });
    const onOld = await failure(approve(v1.roster.id, P.Alpha));
    expect(onOld.code).toBe("CONFLICT");
    expect(await prisma().podApproval.count()).toBe(0);
    // a new version starts with no approvals
    expect((await getRoster(prisma(), v2.roster.id)).podApprovals).toEqual([]);
  });

  it("editing a cell of a pod clears only THAT pod's approval, and says so in the audit log", async () => {
    const { roster } = await generateMonth(prisma(), { month: DEC, actor: "t" });
    const P = await pods();
    await approve(roster.id, P.Alpha);
    await approve(roster.id, P.Bravo);
    // Ishita Verma is in Alpha
    await saveManualEdit(prisma(), {
      rosterId: roster.id,
      employeeId: "emp-ishita-verma",
      date: "2026-12-17",
      status: "WEEKLY_OFF",
      coveredBrandProcessIds: [],
      actor: "t",
    });
    const left = (await getRoster(prisma(), roster.id)).podApprovals.map((a) => a.podId);
    expect(left).toEqual([P.Bravo]);
    const revoke = await prisma().auditLog.findFirstOrThrow({
      where: { action: "REVOKE_POD_APPROVAL" },
    });
    expect(revoke.after).toMatchObject({ reason: "a cell of this pod was edited" });
  });

  it("with approvals required, publishing is BLOCKED naming the pods still missing, and goes through once all are approved", async () => {
    const { roster } = await generateMonth(prisma(), { month: DEC, actor: "t" });
    await ackAll(roster.id); // errors are acknowledged, so approvals are the only thing in the way
    const P = await pods();
    const need = { requirePodApprovals: true };

    const none = await failure(publishRoster(prisma(), { rosterId: roster.id, actor: "t" }, need));
    expect(none.code).toBe("BLOCKED");
    expect(none.message).toContain("4 pod(s) still need");
    for (const name of ["Alpha", "Bravo", "Charlie", "Delta"]) expect(none.message).toContain(name);

    await approve(roster.id, P.Alpha);
    await approve(roster.id, P.Bravo);
    await approve(roster.id, P.Charlie);
    const one = await failure(publishRoster(prisma(), { rosterId: roster.id, actor: "t" }, need));
    expect(one.message).toContain("1 pod(s) still need");
    expect(one.message).toContain("Delta");
    expect((await prisma().roster.findUniqueOrThrow({ where: { id: roster.id } })).status).toBe(
      "DRAFT",
    );

    await approve(roster.id, P.Delta);
    const done = await publishRoster(prisma(), { rosterId: roster.id, actor: "t" }, need);
    expect(done.roster.status).toBe("PUBLISHED");
  });

  it("with approvals not required, publishing ignores them (the default)", async () => {
    const { roster } = await generateMonth(prisma(), { month: DEC, actor: "t" });
    await ackAll(roster.id);
    const done = await publishRoster(
      prisma(),
      { rosterId: roster.id, actor: "t" },
      { requirePodApprovals: false },
    );
    expect(done.roster.status).toBe("PUBLISHED");
  });
});
