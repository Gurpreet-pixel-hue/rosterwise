"use server";

// Server actions for rosters. Thin wrappers over services/roster.ts (see there for the rules).
import { revalidatePath } from "next/cache";
import { prisma } from "../db";
import { guarded, withActor } from "../auth/guard";
import { toResult } from "../errors";
import {
  acknowledgeIssue,
  applyRosterChange,
  applySuggestionToRoster,
  explainRosterIssue,
  generateMonth,
  getRoster,
  listRosterVersions,
  previewManualEdit,
  publishRoster,
  removeAcknowledgement,
  saveManualEdit,
  simulateRosterChange,
} from "../services/roster";
import { approvePod, revokePodApproval } from "../services/approval";

const refresh = (month: string) => revalidatePath(`/roster/${month}`, "layout");

export async function generateRosterAction(input: unknown) {
  return guarded(async (me) => {
    const r = await toResult(() => generateMonth(prisma, withActor(input, me)));
    if (r.ok) refresh(r.data.roster.month);
    return r;
  });
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
  return guarded(async (me) => {
    const r = await toResult(() => saveManualEdit(prisma, withActor(input, me)));
    if (r.ok) revalidatePath("/roster", "layout");
    return r;
  });
}

/** Show what applying one of an issue's suggestions would do, without saving. */
export async function previewSuggestionAction(input: unknown) {
  return toResult(() => applySuggestionToRoster(prisma, input, { commit: false }));
}

export async function applySuggestionAction(input: unknown) {
  return guarded(async (me) => {
    const r = await toResult(() =>
      applySuggestionToRoster(prisma, withActor(input, me), { commit: true }),
    );
    if (r.ok) revalidatePath("/roster", "layout");
    return r;
  });
}

export async function simulateChangeAction(input: unknown) {
  return toResult(() => simulateRosterChange(prisma, input));
}

export async function applyChangeAction(input: unknown) {
  return guarded(async (me) => {
    const r = await toResult(() => applyRosterChange(prisma, withActor(input, me)));
    if (r.ok) refresh(r.data.roster.month);
    return r;
  });
}

export async function acknowledgeIssueAction(input: unknown) {
  return guarded(async (me) => {
    const r = await toResult(() => acknowledgeIssue(prisma, withActor(input, me)));
    if (r.ok) revalidatePath("/roster", "layout");
    return r;
  });
}

export async function removeAcknowledgementAction(rosterId: string, issueId: string) {
  return guarded(async (me) => {
    const r = await toResult(() => removeAcknowledgement(prisma, rosterId, issueId, me.name));
    if (r.ok) revalidatePath("/roster", "layout");
    return r;
  });
}

export async function publishRosterAction(input: unknown) {
  return guarded(async (me) => {
    const r = await toResult(() => publishRoster(prisma, withActor(input, me)));
    if (r.ok) refresh(r.data.roster.month);
    return r;
  });
}

/** Plain-language explanation of one issue: AI-written when a key is configured, else the standard text. */
export async function explainIssueAction(input: unknown) {
  return guarded(() => toResult(() => explainRosterIssue(prisma, input)));
}

/** A pod lead's sign-off on their pod's slice of a draft version (P5.6). */
export async function approvePodAction(input: unknown) {
  return guarded(async (me) => {
    const r = await toResult(() => approvePod(prisma, withActor(input, me)));
    if (r.ok) revalidatePath("/roster", "layout");
    return r;
  });
}

export async function revokePodApprovalAction(input: unknown) {
  return guarded(async (me) => {
    const r = await toResult(() => revokePodApproval(prisma, withActor(input, me)));
    if (r.ok) revalidatePath("/roster", "layout");
    return r;
  });
}
