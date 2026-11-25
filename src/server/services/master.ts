// CRUD for all master data (CLAUDE.md P3). One registry, so every resource gets the same guarantees:
//  - the input is parsed with Zod (an update merges the patch into the stored row and re-parses the
//    whole thing, so cross-field rules such as "shift ends after it starts" always hold),
//  - cross-row rules are checked before writing (a pod lead belongs to the pod, references exist, ...),
//  - database errors become readable ServiceErrors (unique, foreign key, not found),
//  - and every mutation writes an AuditLog row with before and after, in the same transaction.
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ZodType } from "zod";
import { writeAudit, type Db } from "../audit";
import { ServiceError, parse } from "../errors";
import {
  AssignmentInput,
  BrandInput,
  BrandProcessInput,
  CompOffCreditInput,
  CoverageOverrideInput,
  EmployeeInput,
  HolidayInput,
  LeaveInput,
  PodInput,
  ProcessInput,
  actorSchema,
} from "../schemas";

export const RESOURCES = [
  "pod",
  "employee",
  "brand",
  "process",
  "brandProcess",
  "assignment",
  "holiday",
  "leave",
  "compOffCredit",
  "coverageOverride",
] as const;
export type ResourceName = (typeof RESOURCES)[number];

type Row = Record<string, unknown> & { id: string };

/** The few Prisma delegate methods the registry uses, so one code path serves every model. */
interface Delegate {
  findMany(args?: object): Promise<Row[]>;
  findUnique(args: { where: { id: string } }): Promise<Row | null>;
  create(args: { data: Record<string, unknown> }): Promise<Row>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Row>;
  delete(args: { where: { id: string } }): Promise<Row>;
}

interface Def {
  entity: string;
  delegate: (db: Db) => Delegate;
  schema: ZodType<Record<string, unknown>>;
  orderBy: object;
  /** Cross-row rules, run on the final (merged, parsed) data before it is written. */
  check?: (db: Db, data: Record<string, unknown>, existing: Row | null) => Promise<void>;
  /** Extra reasons a delete must be refused (foreign keys already refuse most). */
  guardDelete?: (db: Db, row: Row) => Promise<void>;
}

const asDelegate = (d: unknown) => d as Delegate;
const exists = async (d: Delegate, id: unknown, what: string) => {
  if (typeof id !== "string" || !(await d.findUnique({ where: { id } }))) {
    throw new ServiceError("VALIDATION", `${what} "${String(id)}" does not exist`);
  }
};

const DEFS: Record<ResourceName, Def> = {
  pod: {
    entity: "Pod",
    delegate: (db) => asDelegate(db.pod),
    schema: PodInput,
    orderBy: { name: "asc" },
    check: async (db, data, existing) => {
      if (data.leadId == null) return;
      if (!existing) {
        throw new ServiceError(
          "VALIDATION",
          "Add the pod's employees first, then set its lead by editing the pod.",
        );
      }
      const lead = await db.employee.findUnique({ where: { id: String(data.leadId) } });
      if (!lead)
        throw new ServiceError("VALIDATION", `Lead "${String(data.leadId)}" does not exist`);
      if (lead.podId !== existing.id)
        throw new ServiceError(
          "VALIDATION",
          `${lead.name} belongs to another pod, so cannot lead this one`,
        );
    },
    guardDelete: async (db, row) => {
      const [employees, brands] = await Promise.all([
        db.employee.count({ where: { podId: row.id } }),
        db.brand.count({ where: { podId: row.id } }),
      ]);
      if (employees + brands > 0) {
        throw new ServiceError(
          "CONFLICT",
          `Pod still has ${employees} employee(s) and ${brands} brand(s). Move them first.`,
        );
      }
    },
  },
  employee: {
    entity: "Employee",
    delegate: (db) => asDelegate(db.employee),
    schema: EmployeeInput,
    orderBy: { name: "asc" },
    check: async (db, data, existing) => {
      await exists(asDelegate(db.pod), data.podId, "Pod");
      if (existing && existing.podId !== data.podId) {
        const leads = await db.pod.findFirst({ where: { leadId: existing.id } });
        if (leads)
          throw new ServiceError(
            "CONFLICT",
            `They lead the ${leads.name} pod. Choose another lead before moving them.`,
          );
      }
    },
    guardDelete: async (db, row) => {
      const leads = await db.pod.findFirst({ where: { leadId: row.id } });
      if (leads)
        throw new ServiceError(
          "CONFLICT",
          `They lead the ${leads.name} pod. Choose another lead first.`,
        );
      const entries = await db.rosterEntry.count({ where: { employeeId: row.id } });
      if (entries > 0) {
        throw new ServiceError(
          "CONFLICT",
          "They appear in saved rosters, which must keep their history. Deactivate them instead (set isActive to false).",
        );
      }
    },
  },
  brand: {
    entity: "Brand",
    delegate: (db) => asDelegate(db.brand),
    schema: BrandInput,
    orderBy: { name: "asc" },
    check: async (db, data) => exists(asDelegate(db.pod), data.podId, "Pod"),
    guardDelete: async (db, row) => {
      const n = await db.brandProcess.count({ where: { brandId: row.id } });
      if (n > 0)
        throw new ServiceError("CONFLICT", `Brand still has ${n} process(es). Remove those first.`);
    },
  },
  process: {
    entity: "Process",
    delegate: (db) => asDelegate(db.process),
    schema: ProcessInput,
    orderBy: { code: "asc" },
  },
  brandProcess: {
    entity: "BrandProcess",
    delegate: (db) => asDelegate(db.brandProcess),
    schema: BrandProcessInput,
    orderBy: [{ brandId: "asc" }, { processId: "asc" }],
    check: async (db, data) => {
      await exists(asDelegate(db.brand), data.brandId, "Brand");
      await exists(asDelegate(db.process), data.processId, "Process");
    },
  },
  assignment: {
    entity: "Assignment",
    delegate: (db) => asDelegate(db.assignment),
    schema: AssignmentInput,
    orderBy: [{ brandProcessId: "asc" }, { role: "asc" }, { employeeId: "asc" }],
    check: async (db, data) => {
      await exists(asDelegate(db.employee), data.employeeId, "Employee");
      await exists(asDelegate(db.brandProcess), data.brandProcessId, "Brand-process");
    },
  },
  holiday: {
    entity: "PublicHoliday",
    delegate: (db) => asDelegate(db.publicHoliday),
    schema: HolidayInput,
    orderBy: { date: "asc" },
  },
  leave: {
    entity: "Leave",
    delegate: (db) => asDelegate(db.leave),
    schema: LeaveInput,
    orderBy: [{ fromDate: "asc" }, { employeeId: "asc" }],
    check: async (db, data) => exists(asDelegate(db.employee), data.employeeId, "Employee"),
  },
  compOffCredit: {
    entity: "CompOffCredit",
    delegate: (db) => asDelegate(db.compOffCredit),
    schema: CompOffCreditInput,
    orderBy: [{ earnedOn: "asc" }, { employeeId: "asc" }],
    check: async (db, data) => {
      await exists(asDelegate(db.employee), data.employeeId, "Employee");
      if (
        typeof data.usedOn === "string" &&
        typeof data.earnedOn === "string" &&
        data.usedOn < data.earnedOn
      ) {
        throw new ServiceError("VALIDATION", "A comp-off cannot be used before it was earned");
      }
    },
  },
  coverageOverride: {
    entity: "CoverageOverride",
    delegate: (db) => asDelegate(db.coverageOverride),
    schema: CoverageOverrideInput,
    orderBy: [{ date: "asc" }, { brandProcessId: "asc" }],
    check: async (db, data) =>
      exists(asDelegate(db.brandProcess), data.brandProcessId, "Brand-process"),
  },
};

export const isResource = (x: string): x is ResourceName =>
  (RESOURCES as readonly string[]).includes(x);

function def(resource: string): Def {
  if (!isResource(resource)) throw new ServiceError("VALIDATION", `Unknown resource "${resource}"`);
  return DEFS[resource];
}

/** Json columns need Prisma's null sentinel; everything else passes through. */
function toDb(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if (
    "weekdayMinStaff" in out &&
    (out.weekdayMinStaff === null || out.weekdayMinStaff === undefined)
  ) {
    out.weekdayMinStaff = Prisma.JsonNull;
  }
  return out;
}

/** What goes into the audit log: a JSON-safe copy of a row. */
const snap = (row: Row | null): unknown => (row ? JSON.parse(JSON.stringify(row)) : null);

/** Turn Prisma's constraint errors into messages a manager can act on. */
function mapDbError(e: unknown, what: string, verb: "save" | "delete"): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      const fields = (e.meta?.target as string[] | undefined)?.join(", ") ?? "those values";
      throw new ServiceError("CONFLICT", `${what} already exists with the same ${fields}`);
    }
    if (e.code === "P2003") {
      throw verb === "delete"
        ? new ServiceError(
            "CONFLICT",
            `${what} is still used by other records. Remove or reassign those first.`,
          )
        : new ServiceError("VALIDATION", `${what} refers to something that does not exist`);
    }
    if (e.code === "P2025") throw new ServiceError("NOT_FOUND", `${what} was not found`);
  }
  throw e;
}

export async function listRecords(db: Db, resource: string): Promise<Row[]> {
  const d = def(resource);
  return d.delegate(db).findMany({ orderBy: d.orderBy });
}

export async function getRecord(db: Db, resource: string, id: string): Promise<Row> {
  const d = def(resource);
  const row = await d.delegate(db).findUnique({ where: { id } });
  if (!row) throw new ServiceError("NOT_FOUND", `${d.entity} "${id}" was not found`);
  return row;
}

export async function createRecord(
  prisma: PrismaClient,
  resource: string,
  input: unknown,
  actor: string = "manager",
): Promise<Row> {
  const d = def(resource);
  const who = parse(actorSchema, actor, "actor");
  const data = parse(d.schema, input, d.entity);
  try {
    return await prisma.$transaction(async (tx) => {
      await d.check?.(tx, data, null);
      const row = await d.delegate(tx).create({ data: toDb(data) });
      await writeAudit(tx, {
        actor: who,
        action: "CREATE",
        entity: d.entity,
        entityId: row.id,
        after: snap(row),
      });
      return row;
    });
  } catch (e) {
    return mapDbError(e, d.entity, "save");
  }
}

export async function updateRecord(
  prisma: PrismaClient,
  resource: string,
  id: string,
  patch: unknown,
  actor: string = "manager",
): Promise<Row> {
  const d = def(resource);
  const who = parse(actorSchema, actor, "actor");
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new ServiceError("VALIDATION", "The change must be an object of fields to update");
  }
  const known = new Set(
    Object.keys((d.schema as unknown as { shape: Record<string, unknown> }).shape),
  );
  const unknown = Object.keys(patch).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new ServiceError("VALIDATION", `Unknown field(s) for ${d.entity}: ${unknown.join(", ")}`);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await d.delegate(tx).findUnique({ where: { id } });
      if (!existing) throw new ServiceError("NOT_FOUND", `${d.entity} "${id}" was not found`);
      // merge the patch into the stored row and validate the WHOLE result
      const { id: _id, ...stored } = existing;
      void _id;
      const data = parse(d.schema, { ...stored, ...patch }, d.entity);
      await d.check?.(tx, data, existing);
      const row = await d.delegate(tx).update({ where: { id }, data: toDb(data) });
      await writeAudit(tx, {
        actor: who,
        action: "UPDATE",
        entity: d.entity,
        entityId: id,
        before: snap(existing),
        after: snap(row),
      });
      return row;
    });
  } catch (e) {
    return mapDbError(e, d.entity, "save");
  }
}

export async function deleteRecord(
  prisma: PrismaClient,
  resource: string,
  id: string,
  actor: string = "manager",
): Promise<void> {
  const d = def(resource);
  const who = parse(actorSchema, actor, "actor");
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await d.delegate(tx).findUnique({ where: { id } });
      if (!existing) throw new ServiceError("NOT_FOUND", `${d.entity} "${id}" was not found`);
      await d.guardDelete?.(tx, existing);
      await d.delegate(tx).delete({ where: { id } });
      await writeAudit(tx, {
        actor: who,
        action: "DELETE",
        entity: d.entity,
        entityId: id,
        before: snap(existing),
      });
    });
  } catch (e) {
    mapDbError(e, d.entity, "delete");
  }
}

/** "Removing" an employee keeps their history: they are deactivated, not deleted. */
export const deactivateEmployee = (prisma: PrismaClient, id: string, actor?: string) =>
  updateRecord(prisma, "employee", id, { isActive: false }, actor);

export const reactivateEmployee = (prisma: PrismaClient, id: string, actor?: string) =>
  updateRecord(prisma, "employee", id, { isActive: true }, actor);
