// Pod-lead sign-off (CLAUDE.md P5.6). A lead approves their pod's slice of one DRAFT roster version; the approval
// is cleared if any of the pod's cells is edited afterwards (see editCells) and a new version starts with none.
// Publishing requires every pod only when REQUIRE_POD_APPROVAL is set (see publishRoster).
//
// Limit, stated plainly: there is no per-user login, so the service cannot prove the approver IS the pod lead. It
// records who the caller says they are, like every other audited action. The shared-passcode session (P6)
// supplies the display name from the server; this is where a "must match the pod lead" check would go.
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "../audit";
import { ServiceError, parse } from "../errors";
import { actorSchema } from "../schemas";
import { lockRoster, requireDraft, requireLatest, rosterRow } from "./roster";

const ApproveInput = z.object({
  rosterId: z.string().min(1).max(100),
  podId: z.string().min(1).max(100),
  actor: actorSchema,
  note: z.string().trim().max(300).nullish(),
});

export interface PodApprovalView {
  podId: string;
  approvedBy: string;
  note: string | null;
  createdAt: string;
}

export async function listPodApprovals(
  prisma: PrismaClient,
  rosterId: string,
): Promise<PodApprovalView[]> {
  const rows = await prisma.podApproval.findMany({
    where: { rosterId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    podId: r.podId,
    approvedBy: r.approvedBy,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function approvePod(prisma: PrismaClient, raw: unknown): Promise<PodApprovalView> {
  const { rosterId, podId, actor, note } = parse(ApproveInput, raw, "approval");
  return prisma.$transaction(async (tx) => {
    await lockRoster(tx, rosterId);
    const roster = await rosterRow(tx, rosterId);
    requireDraft(roster);
    await requireLatest(tx, roster);
    const pod = await tx.pod.findUnique({ where: { id: podId } });
    if (!pod) throw new ServiceError("NOT_FOUND", `Pod "${podId}" was not found.`);
    const row = await tx.podApproval.upsert({
      where: { rosterId_podId: { rosterId, podId } },
      create: { rosterId, podId, approvedBy: actor, note: note ?? null },
      update: { approvedBy: actor, note: note ?? null, createdAt: new Date() },
    });
    await writeAudit(tx, {
      actor,
      action: "APPROVE_POD",
      entity: "PodApproval",
      entityId: row.id,
      rosterId,
      after: { pod: pod.name, version: roster.version, note: note ?? null },
    });
    return {
      podId,
      approvedBy: row.approvedBy,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function revokePodApproval(prisma: PrismaClient, raw: unknown): Promise<void> {
  const { rosterId, podId, actor } = parse(ApproveInput, raw, "approval");
  await prisma.$transaction(async (tx) => {
    await lockRoster(tx, rosterId);
    const roster = await rosterRow(tx, rosterId);
    requireDraft(roster);
    await requireLatest(tx, roster);
    const row = await tx.podApproval.findUnique({ where: { rosterId_podId: { rosterId, podId } } });
    if (!row) throw new ServiceError("NOT_FOUND", "That pod is not approved on this version.");
    await tx.podApproval.delete({ where: { id: row.id } });
    await writeAudit(tx, {
      actor,
      action: "REVOKE_POD_APPROVAL",
      entity: "PodApproval",
      entityId: row.id,
      rosterId,
      before: { approvedBy: row.approvedBy },
    });
  });
}
