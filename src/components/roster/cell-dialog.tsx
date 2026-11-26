"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { previewEditAction, saveEditAction } from "@/server/actions/roster";
import type { ManualEditResult } from "@/server/services/roster";
import type { DraftEntry, EntryStatus, Issue } from "@/engine/types";
import type { RosterRefs } from "@/server/pageData";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ACTOR } from "@/lib/config";
import {
  STATUS_CODE,
  STATUS_LABEL,
  carriedOffWarning,
  dayLabel,
  monthTitle,
} from "@/lib/roster-view";
import { SeverityBadge } from "./status-style";

const STATUSES = Object.keys(STATUS_CODE) as EntryStatus[];

export interface CellTarget {
  employeeId: string;
  date: string;
}

function IssueLine({ issue }: { issue: Pick<Issue, "severity" | "message"> }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <SeverityBadge severity={issue.severity} className="mt-0.5 shrink-0" />
      <span>{issue.message}</span>
    </li>
  );
}

function List({ items, limit = 5 }: { items: Issue[]; limit?: number }) {
  return (
    <ul className="space-y-1.5">
      {items.slice(0, limit).map((i) => (
        <IssueLine key={i.id} issue={i} />
      ))}
      {items.length > limit && (
        <li className="text-xs text-muted-foreground">and {items.length - limit} more</li>
      )}
    </ul>
  );
}

export function CellDialog({
  target,
  entry,
  refs,
  rosterId,
  rosterMonth,
  editable,
  readOnlyReason,
  foreignMonth,
  issues,
  onClose,
  onSaved,
}: {
  target: CellTarget | null;
  entry: DraftEntry | undefined;
  refs: RosterRefs;
  rosterId: string;
  rosterMonth: string;
  /** False for a published or superseded roster. */
  editable: boolean;
  readOnlyReason: string | null;
  /** The month whose roster owns this day, when it is not this one. */
  foreignMonth: string | null;
  issues: Issue[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const emp = target ? refs.employees.find((e) => e.id === target.employeeId) : undefined;
  const mine = useMemo(
    () =>
      target
        ? refs.assignments
            .filter((a) => a.employeeId === target.employeeId)
            .map((a) => {
              const bp = refs.brandProcesses.find((b) => b.id === a.brandProcessId);
              return { ...a, label: bp ? `${bp.brandName} / ${bp.processCode}` : a.brandProcessId };
            })
            .sort((a, b) => a.label.localeCompare(b.label))
        : [],
    [target, refs],
  );

  const [status, setStatus] = useState<EntryStatus>("WORK");
  const [covered, setCovered] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ManualEditResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // reset when a different cell opens
  const targetKey = target ? `${target.employeeId}|${target.date}` : null;
  useEffect(() => {
    if (!entry) return;
    setStatus(entry.status);
    setCovered(new Set(entry.coveredBrandProcessIds));
    setPreview(null);
    setError(null);
  }, [targetKey, entry]);

  const changed = useMemo(() => {
    if (!entry) return false;
    const a = [...covered].sort().join(",");
    const b = [...entry.coveredBrandProcessIds].sort().join(",");
    return status !== entry.status || a !== b;
  }, [entry, status, covered]);

  const canEdit = editable && !foreignMonth;

  // live preview: what would this edit do, before anything is saved
  useEffect(() => {
    if (!target || !entry || !changed || !canEdit) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      const r = await previewEditAction({
        rosterId,
        employeeId: target.employeeId,
        date: target.date,
        status,
        coveredBrandProcessIds: [...covered],
        actor: ACTOR,
      });
      if (cancelled) return;
      setPreviewing(false);
      if (r.ok) {
        setPreview(r.data);
        setError(null);
      } else {
        setPreview(null);
        setError(r.error.message);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [target, entry, changed, canEdit, status, covered, rosterId]);

  function chooseStatus(s: EntryStatus) {
    setStatus(s);
    if (s !== "WORK") setCovered(new Set());
    else if (covered.size === 0)
      setCovered(new Set(mine.filter((a) => a.role === "PRIMARY").map((a) => a.brandProcessId)));
  }

  async function save() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const r = await saveEditAction({
      rosterId,
      employeeId: target.employeeId,
      date: target.date,
      status,
      coveredBrandProcessIds: [...covered],
      actor: ACTOR,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    const added = r.data.delta.added.length;
    const resolved = r.data.delta.resolved.length;
    onSaved(
      `Saved ${emp?.name} on ${dayLabel(target.date)}: ${STATUS_LABEL[status]}. ${added} issue(s) added, ${resolved} resolved.`,
    );
  }

  const staticWarning =
    emp && target && entry?.status === "WEEKLY_OFF"
      ? carriedOffWarning(emp.name, target.date, rosterMonth)
      : null;
  const addedErrors = preview?.delta.added.filter((i) => i.severity === "ERROR").length ?? 0;
  const neighbour = preview?.neighbourImpact ?? null;
  const neighbourErrors = neighbour?.added.filter((i) => i.severity === "ERROR").length ?? 0;

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {emp?.name} · {target ? dayLabel(target.date) : ""}
          </DialogTitle>
          <DialogDescription>
            Currently {entry ? STATUS_LABEL[entry.status] : ""}
            {entry?.source === "MANUAL" ? ", edited by hand" : ""}. Changes are checked by the same
            validator as the generator, and shown below before you save.
          </DialogDescription>
        </DialogHeader>

        {foreignMonth && target && (
          <p className="rounded-md border border-slate-300 bg-slate-50 p-2.5 text-sm" role="note">
            This day belongs to the {monthTitle(foreignMonth)} roster, so it is read-only here.{" "}
            <Link className="font-medium underline" href={`/roster/${foreignMonth}`}>
              Open the {monthTitle(foreignMonth)} roster
            </Link>{" "}
            to change it; it then shows here too.
          </p>
        )}
        {!foreignMonth && !editable && readOnlyReason && (
          <p className="rounded-md border border-slate-300 bg-slate-50 p-2.5 text-sm" role="note">
            {readOnlyReason}
          </p>
        )}
        {canEdit && staticWarning && (
          <p
            className="rounded-md border border-amber-400 bg-amber-50 p-2.5 text-sm text-amber-950"
            role="alert"
          >
            {staticWarning.text}
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cell-status">Status</Label>
            <NativeSelect
              id="cell-status"
              value={status}
              disabled={!canEdit}
              onChange={(e) => chooseStatus(e.target.value as EntryStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_CODE[s]} · {STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </div>

          <fieldset className="space-y-1.5" disabled={!canEdit || status !== "WORK"}>
            <legend className="text-sm font-medium">Covers (brand / process)</legend>
            {mine.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Not assigned to any brand: part of the backup pool. Assign them under Setup,
                Assignments.
              </p>
            )}
            {mine.map((a) => (
              <div key={a.brandProcessId} className="flex items-center gap-2">
                <Checkbox
                  id={`cov-${a.brandProcessId}`}
                  checked={covered.has(a.brandProcessId)}
                  onCheckedChange={(c) => {
                    const next = new Set(covered);
                    if (c) next.add(a.brandProcessId);
                    else next.delete(a.brandProcessId);
                    setCovered(next);
                  }}
                />
                <Label htmlFor={`cov-${a.brandProcessId}`} className="font-normal">
                  {a.label}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {a.role.toLowerCase()} · {a.allocationPct}%
                  </span>
                </Label>
              </div>
            ))}
          </fieldset>

          {issues.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Issues on this day
              </h4>
              <List items={issues} />
            </div>
          )}

          {changed && canEdit && (
            <div className="space-y-2 rounded-md border p-3" aria-live="polite">
              <h4 className="text-sm font-semibold">Before you save</h4>
              {previewing && !preview && (
                <p className="text-xs text-muted-foreground">Checking...</p>
              )}
              {preview && (
                <>
                  <p className="text-sm">
                    Errors on this roster: <strong>{preview.errorsBefore}</strong> to{" "}
                    <strong
                      className={preview.errorsAfter > preview.errorsBefore ? "text-red-700" : ""}
                    >
                      {preview.errorsAfter}
                    </strong>
                    .{" "}
                    {preview.delta.added.length === 0 && preview.delta.resolved.length === 0
                      ? "No other issue changes."
                      : ""}
                  </p>
                  {preview.delta.added.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-red-800">
                        Adds {preview.delta.added.length}
                      </div>
                      <List items={preview.delta.added} />
                    </div>
                  )}
                  {preview.delta.resolved.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-emerald-800">
                        Resolves {preview.delta.resolved.length}
                      </div>
                      <List items={preview.delta.resolved} limit={3} />
                    </div>
                  )}
                  {neighbour && (
                    <div
                      className="space-y-1 rounded border border-amber-400 bg-amber-50 p-2 text-amber-950"
                      role="alert"
                    >
                      <div className="text-xs font-semibold">
                        This also changes the {monthTitle(neighbour.month)} roster
                        {neighbourErrors > 0
                          ? `: ${neighbourErrors} new ERROR${neighbourErrors > 1 ? "S" : ""} there`
                          : ""}
                      </div>
                      <List items={neighbour.added} limit={3} />
                      {neighbour.resolved.length > 0 && (
                        <div className="text-xs">Resolves {neighbour.resolved.length} there.</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button
              onClick={save}
              disabled={!changed || busy || previewing || !preview}
              variant={addedErrors > 0 || neighbourErrors > 0 ? "destructive" : "default"}
            >
              {busy
                ? "Saving..."
                : addedErrors + neighbourErrors > 0
                  ? `Save anyway (${addedErrors + neighbourErrors} new error${addedErrors + neighbourErrors > 1 ? "s" : ""})`
                  : "Save change"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
