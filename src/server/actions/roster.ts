"use server";

// Server actions for rosters. Thin wrappers over services/roster.ts (see there for the rules).
import { revalidatePath } from "next/cache";
import { prisma } from "../db";
import { toResult } from "../errors";
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

const refresh = (month: string) => revalidatePath(`/roster/${month}`, "layout");

export async function generateRosterAction(input: unknown) {
  const r = await toResult(() => generateMonth(prisma, input));
  if (r.ok) refresh(r.data.roster.month);
  return r;
}

export async function getRosterAction(rosterId: string, suggestions = false) {
  return toResult(() => getRoster(prisma, rosterId, { suggestions }));
}

export async function listRosterVersionsAction(month: string) {
  return toResult(() => listRosterVersions(prisma, month));
}

/** Validate an edit and return the issue delta WITHOUT saving it. */
export async function previewEditAction(input: unknown) {
  return toResult(() => previewManualEdit(prisma, input));
}

export async function saveEditAction(input: unknown) {
  const r = await toResult(() => saveManualEdit(prisma, input));
  if (r.ok) revalidatePath("/roster", "layout");
  return r;
}

export async function simulateChangeAction(input: unknown) {
  return toResult(() => simulateRosterChange(prisma, input));
}

export async function applyChangeAction(input: unknown) {
  const r = await toResult(() => applyRosterChange(prisma, input));
  if (r.ok) refresh(r.data.roster.month);
  return r;
}

export async function acknowledgeIssueAction(input: unknown) {
  const r = await toResult(() => acknowledgeIssue(prisma, input));
  if (r.ok) revalidatePath("/roster", "layout");
  return r;
}

export async function removeAcknowledgementAction(
  rosterId: string,
  issueId: string,
  actor?: string,
) {
  const r = await toResult(() => removeAcknowledgement(prisma, rosterId, issueId, actor));
  if (r.ok) revalidatePath("/roster", "layout");
  return r;
}

export async function publishRosterAction(input: unknown) {
  const r = await toResult(() => publishRoster(prisma, input));
  if (r.ok) refresh(r.data.roster.month);
  return r;
}
