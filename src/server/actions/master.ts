"use server";

// Server actions for master data. Thin on purpose: validation, rules and auditing live in
// services/master.ts, which the integration tests exercise directly.
import { revalidatePath } from "next/cache";
import { prisma } from "../db";
import { toResult } from "../errors";
import {
  createRecord,
  deactivateEmployee,
  deleteRecord,
  getRecord,
  listRecords,
  reactivateEmployee,
  updateRecord,
} from "../services/master";

const refresh = () => revalidatePath("/setup", "layout");

export async function listRecordsAction(resource: string) {
  return toResult(() => listRecords(prisma, resource));
}

export async function getRecordAction(resource: string, id: string) {
  return toResult(() => getRecord(prisma, resource, id));
}

export async function createRecordAction(resource: string, input: unknown, actor?: string) {
  const r = await toResult(() => createRecord(prisma, resource, input, actor));
  if (r.ok) refresh();
  return r;
}

export async function updateRecordAction(
  resource: string,
  id: string,
  patch: unknown,
  actor?: string,
) {
  const r = await toResult(() => updateRecord(prisma, resource, id, patch, actor));
  if (r.ok) refresh();
  return r;
}

export async function deleteRecordAction(resource: string, id: string, actor?: string) {
  const r = await toResult(() => deleteRecord(prisma, resource, id, actor));
  if (r.ok) refresh();
  return r;
}

export async function deactivateEmployeeAction(id: string, actor?: string) {
  const r = await toResult(() => deactivateEmployee(prisma, id, actor));
  if (r.ok) refresh();
  return r;
}

export async function reactivateEmployeeAction(id: string, actor?: string) {
  const r = await toResult(() => reactivateEmployee(prisma, id, actor));
  if (r.ok) refresh();
  return r;
}
