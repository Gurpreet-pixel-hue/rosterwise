import type { Prisma, PrismaClient } from "@prisma/client";

/** Either the client or a transaction: services pass whichever they are running in. */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  rosterId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Record who did what, when, to what, with the before and after. Always call inside the same transaction as the change. */
export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actor: e.actor,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      rosterId: e.rosterId ?? null,
      before: e.before === undefined ? undefined : (e.before as Prisma.InputJsonValue),
      after: e.after === undefined ? undefined : (e.after as Prisma.InputJsonValue),
    },
  });
}
