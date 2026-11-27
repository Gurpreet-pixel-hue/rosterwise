"use client";

import { useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { approvePodAction, revokePodApprovalAction } from "@/server/actions/roster";
import type { RosterRefs } from "@/server/pageData";
import { Button } from "@/components/ui/button";
import { dayLabel } from "@/lib/roster-view";

interface Approval {
  podId: string;
  approvedBy: string;
  note: string | null;
  createdAt: string;
}

/** Pod-lead sign-off on this version (CLAUDE.md P5.6). */
export function ApprovalPanel({
  rosterId,
  refs,
  approvals,
  required,
  editable,
  onDone,
}: {
  rosterId: string;
  refs: RosterRefs;
  approvals: Approval[];
  required: boolean;
  editable: boolean;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byPod = new Map(approvals.map((a) => [a.podId, a]));
  const sizes = new Map<string, number>();
  for (const e of refs.employees) if (e.isActive) sizes.set(e.podId, (sizes.get(e.podId) ?? 0) + 1);
  const pods = refs.pods.filter((p) => (sizes.get(p.id) ?? 0) > 0);
  const nameOf = (id: string | null) =>
    refs.employees.find((e) => e.id === id)?.name ?? "no lead set";

  async function act(podId: string, podName: string, approve: boolean) {
    setBusy(podId);
    setError(null);
    const r = approve
      ? await approvePodAction({ rosterId, podId })
      : await revokePodApprovalAction({ rosterId, podId });
    setBusy(null);
    if (!r.ok) return setError(r.error.message);
    onDone(approve ? `${podName} approved.` : `${podName} approval withdrawn.`);
  }

  return (
    <section aria-label="Pod approval" className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Each pod lead signs off their pod&apos;s part of this version.{" "}
        {required
          ? "In this deployment publishing needs every pod approved."
          : "Optional here: publishing does not wait for it."}{" "}
        A sign-off is cleared if any of that pod&apos;s cells is edited, and a new version starts
        with none. There is no per-person login yet, so the name is recorded, not verified.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      <ul className="divide-y divide-border rounded-md border border-border">
        {pods.map((p) => {
          const a = byPod.get(p.id);
          return (
            <li key={p.id} className="flex items-start gap-2 p-2.5" data-pod-approval={p.id}>
              {a ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-tight">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  Lead: {nameOf(p.leadId)} · {sizes.get(p.id)} people
                </div>
                {a && (
                  <div className="text-xs text-emerald-800">
                    Approved by {a.approvedBy} on {dayLabel(a.createdAt.slice(0, 10))}
                  </div>
                )}
              </div>
              {a ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!editable || busy !== null}
                  onClick={() => act(p.id, p.name, false)}
                >
                  Withdraw
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!editable || busy !== null}
                  onClick={() => act(p.id, p.name, true)}
                  aria-label={`Approve ${p.name}`}
                >
                  {busy === p.id ? "Approving..." : "Approve"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
