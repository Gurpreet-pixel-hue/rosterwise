"use client";

import { useState } from "react";
import { ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { createRecordAction } from "@/server/actions/master";
import type { BackupReport } from "@/engine/backup";
import { Button } from "@/components/ui/button";
import { ACTOR } from "@/lib/config";
import { cn } from "@/lib/utils";

const STATUS: Record<BackupReport["status"], { label: string; tone: string }> = {
  EXPOSED: { label: "No backup", tone: "bg-red-100 text-red-900 border-red-300" },
  NO_STAFF: { label: "Nobody assigned", tone: "bg-red-100 text-red-900 border-red-300" },
  COVERED_BY_BACKUP: {
    label: "Has backup",
    tone: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  SHARED: { label: "Shared by several", tone: "bg-slate-100 text-slate-800 border-slate-300" },
};

/** Backup recommendations for the brand-processes in the current view (CLAUDE.md P5.1). */
export function BackupPanel({
  reports,
  onDone,
}: {
  reports: BackupReport[];
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(r: BackupReport, c: BackupReport["candidates"][number]) {
    const key = `${r.brandProcessId}:${c.employeeId}`;
    setBusy(key);
    setError(null);
    const res = await createRecordAction(
      "assignment",
      {
        employeeId: c.employeeId,
        brandProcessId: r.brandProcessId,
        role: "BACKUP",
        allocationPct: c.suggestedPct,
        note: "Added from the backup recommendations on the roster page. Remove it here if it is no longer needed.",
      },
      ACTOR,
    );
    setBusy(null);
    if (!res.ok) return setError(res.error.message);
    onDone(
      `Added ${c.name} as a backup (${c.suggestedPct}%) for ${r.brandName} / ${r.processCode}. It applies to the next roster you generate or re-plan; saved rosters are not rewritten.`,
    );
  }

  const exposed = reports.filter((r) => r.status === "EXPOSED" || r.status === "NO_STAFF");
  const rest = reports.filter((r) => !exposed.includes(r));

  return (
    <section aria-label="Backup recommendations" className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        A brand-process is <strong>exposed</strong> when one absence leaves it short and nobody
        stands behind the primary. Candidates are ranked: same pod as the brand first, then the most
        spare allocation, and only people whose day still fits their daily hours. Adding one is
        permanent until removed in Setup.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      {reports.length === 0 && (
        <p className="text-sm text-muted-foreground">No brand rules in this view.</p>
      )}
      {[...exposed, ...rest].map((r) => (
        <div
          key={r.brandProcessId}
          className="space-y-2 rounded-md border border-border p-2.5"
          data-backup={r.brandProcessId}
        >
          <div className="flex items-start gap-2">
            {r.status === "EXPOSED" || r.status === "NO_STAFF" ? (
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-700" />
            ) : r.status === "COVERED_BY_BACKUP" ? (
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-700" />
            ) : (
              <Users className="mt-0.5 size-4 shrink-0 text-slate-600" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium leading-tight">
                {r.brandName} / {r.processCode}
              </div>
              <div className="text-xs text-muted-foreground">
                Primary:{" "}
                {r.primaries.map((p) => `${p.name} (${p.allocationPct}%)`).join(", ") || "none"}
                {r.backups.length > 0 && (
                  <>
                    <br />
                    Backup: {r.backups.map((p) => `${p.name} (${p.allocationPct}%)`).join(", ")}
                  </>
                )}
                <br />
                Needs up to {r.peakRequired} on a day.
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                STATUS[r.status].tone,
              )}
            >
              {STATUS[r.status].label}
            </span>
          </div>
          {r.candidates.length > 0 && (
            <ul className="space-y-1.5">
              {r.candidates.map((c) => (
                <li
                  key={c.employeeId}
                  className="flex items-start gap-2 rounded bg-muted/50 p-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-muted-foreground">{c.reason}</div>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => add(r, c)}
                    aria-label={`Add ${c.name} as backup for ${r.brandName} ${r.processCode}`}
                  >
                    {busy === `${r.brandProcessId}:${c.employeeId}`
                      ? "Adding..."
                      : `Add as backup (${c.suggestedPct}%)`}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {(r.status === "EXPOSED" || r.status === "NO_STAFF") && r.candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nobody has spare allocation and a shift that fits. Free someone up in Setup,
              Assignments.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
