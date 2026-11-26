"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Crosshair } from "lucide-react";
import {
  acknowledgeIssueAction,
  applySuggestionAction,
  removeAcknowledgementAction,
} from "@/server/actions/roster";
import type { IssueWithAck } from "@/server/services/roster";
import type { Suggestion } from "@/engine/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACTOR } from "@/lib/config";
import { dayLabel, groupBySeverity, issueTarget } from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./status-style";

/** The explanation starts with the issue message; show only what it adds. */
function extra(explanation: string | undefined, message: string): string {
  if (!explanation) return "";
  const rest = explanation.startsWith(message) ? explanation.slice(message.length) : explanation;
  return rest.trim();
}

const SUGGESTION_LABEL: Record<Suggestion["type"], string> = {
  USE_BACKUP: "Use backup",
  SWAP_OFF_DAY: "Swap off day",
  REASSIGN_FROM_POD: "Borrow from pod",
  ACCEPT_GAP: "Accept",
};

export function IssuesPanel({
  issues,
  emptyText,
  explanations,
  rosterId,
  editable,
  readOnlyReason,
  onJump,
  onDone,
}: {
  issues: IssueWithAck[];
  emptyText: string;
  explanations: Record<string, string>;
  rosterId: string;
  editable: boolean;
  readOnlyReason: string | null;
  onJump: (issue: IssueWithAck) => void;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    ERROR: true,
    WARNING: true,
    INFO: false,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setError = (id: string, m: string | null) =>
    setErrors((e) => {
      const n = { ...e };
      if (m) n[id] = m;
      else delete n[id];
      return n;
    });

  async function apply(issue: IssueWithAck, index: number) {
    const key = `${issue.id}:${index}`;
    setBusy(key);
    setError(issue.id, null);
    const r = await applySuggestionAction({
      rosterId,
      issueId: issue.id,
      suggestionIndex: index,
      actor: ACTOR,
    });
    setBusy(null);
    setConfirming(null);
    if (!r.ok) return setError(issue.id, r.error.message);
    const d = r.data.delta;
    onDone(
      `Applied: ${r.data.suggestion.description} Resolved ${d.resolved.length}, added ${d.added.length}${
        r.data.assignmentsCreated
          ? `, created ${r.data.assignmentsCreated} temporary assignment(s)`
          : ""
      }.`,
    );
  }

  async function acknowledge(issue: IssueWithAck) {
    setBusy(`ack:${issue.id}`);
    setError(issue.id, null);
    const r = await acknowledgeIssueAction({
      rosterId,
      issueId: issue.id,
      note: notes[issue.id] ?? "",
      actor: ACTOR,
    });
    setBusy(null);
    if (!r.ok) return setError(issue.id, r.error.message);
    onDone("Acknowledged. The note is saved with the roster and the audit log.");
  }

  async function withdraw(issue: IssueWithAck) {
    setBusy(`ack:${issue.id}`);
    const r = await removeAcknowledgementAction(rosterId, issue.id, ACTOR);
    setBusy(null);
    if (!r.ok) return setError(issue.id, r.error.message);
    onDone("Acknowledgement withdrawn.");
  }

  const groups = groupBySeverity(issues);

  return (
    <section aria-label="Issues" className="space-y-3">
      {!editable && readOnlyReason && (
        <p className="rounded-md border bg-muted/50 p-2.5 text-xs" role="note">
          {readOnlyReason}
        </p>
      )}
      {issues.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      {groups.map(({ severity, issues: list }) =>
        list.length === 0 ? null : (
          <div key={severity}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 border-b pb-1 text-left"
              onClick={() => setOpen((o) => ({ ...o, [severity]: !o[severity] }))}
              aria-expanded={open[severity]}
            >
              {open[severity] ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <SeverityBadge severity={severity} />
              <span className="text-sm font-medium">{list.length}</span>
              {severity === "ERROR" && (
                <span className="text-xs text-muted-foreground">
                  block publishing until fixed or acknowledged
                </span>
              )}
            </button>
            {open[severity] && (
              <ul className="divide-y">
                {list.map((issue) => {
                  const isOpen =
                    expanded.has(issue.id) || (severity === "ERROR" && list.length <= 6);
                  const target = issueTarget(issue);
                  const err = errors[issue.id];
                  return (
                    <li key={issue.id} className="space-y-2 py-2.5" data-issue={issue.id}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <code className="font-mono text-[11px]">{issue.code}</code>
                            {issue.date && <span>{dayLabel(issue.date)}</span>}
                            {issue.acknowledgement && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-900">
                                Acknowledged
                              </span>
                            )}
                            {issue.changedSince && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">
                                Acknowledged earlier, changed since
                              </span>
                            )}
                          </div>
                          <p className="text-sm leading-snug">{issue.message}</p>
                        </div>
                        <div className="flex shrink-0 items-center">
                          {target && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Show on the roster"
                              title="Show on the roster"
                              onClick={() => onJump(issue)}
                            >
                              <Crosshair />
                            </Button>
                          )}
                          {severity !== "INFO" && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={isOpen ? "Hide details" : "Show details"}
                              onClick={() =>
                                setExpanded((s) => {
                                  const n = new Set(s);
                                  if (n.has(issue.id)) n.delete(issue.id);
                                  else n.add(issue.id);
                                  return n;
                                })
                              }
                            >
                              {isOpen ? <ChevronDown /> : <ChevronRight />}
                            </Button>
                          )}
                        </div>
                      </div>

                      {isOpen && severity !== "INFO" && (
                        <div className="space-y-2 pl-0.5">
                          {extra(explanations[issue.id], issue.message) && (
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {extra(explanations[issue.id], issue.message)}
                            </p>
                          )}
                          {issue.changedSince && (
                            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
                              You acknowledged this when it read: &ldquo;
                              {issue.changedSince.previousMessage}&rdquo; ({issue.changedSince.note}
                              ). It reads differently now, so it blocks publishing again.
                            </p>
                          )}
                          {issue.acknowledgement && (
                            <p className="text-xs text-muted-foreground">
                              {issue.acknowledgement.actor}: &ldquo;{issue.acknowledgement.note}
                              &rdquo;{" "}
                              {editable && (
                                <button
                                  type="button"
                                  className="underline"
                                  disabled={busy === `ack:${issue.id}`}
                                  onClick={() => withdraw(issue)}
                                >
                                  Withdraw
                                </button>
                              )}
                            </p>
                          )}

                          {issue.suggestions.filter((s) => s.type !== "ACCEPT_GAP").length > 0 && (
                            <ul className="space-y-1.5">
                              {issue.suggestions.map((s, i) =>
                                s.type === "ACCEPT_GAP" ? null : (
                                  <li key={i} className="rounded-md border p-2">
                                    <div className="flex items-start gap-2">
                                      <div className="min-w-0 flex-1 text-xs leading-snug">
                                        <span className="mr-1.5 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                          {SUGGESTION_LABEL[s.type]}
                                        </span>
                                        {s.description}
                                        <span className="ml-1 text-muted-foreground">
                                          {s.newWarnings === 0
                                            ? "No new warnings."
                                            : `Adds ${s.newWarnings} warning(s).`}
                                        </span>
                                      </div>
                                      {confirming !== `${issue.id}:${i}` && (
                                        <Button
                                          size="xs"
                                          disabled={!editable || busy !== null}
                                          onClick={() =>
                                            s.temporaryAssignments?.length
                                              ? setConfirming(`${issue.id}:${i}`)
                                              : apply(issue, i)
                                          }
                                        >
                                          {busy === `${issue.id}:${i}` ? "Applying..." : "Apply"}
                                        </Button>
                                      )}
                                    </div>
                                    {confirming === `${issue.id}:${i}` && (
                                      <div className="mt-2 space-y-2 rounded bg-amber-50 p-2 text-xs text-amber-950">
                                        <p>
                                          This needs a manager-approved temporary assignment:{" "}
                                          {s
                                            .temporaryAssignments!.map(
                                              (a) =>
                                                `${a.role.toLowerCase()} on ${a.brandProcessId.replace(/^bp-/, "")}`,
                                            )
                                            .join(", ")}
                                          . It is added to Setup, Assignments and stays until you
                                          remove it.
                                        </p>
                                        <div className="flex gap-1.5">
                                          <Button
                                            size="xs"
                                            disabled={busy !== null}
                                            onClick={() => apply(issue, i)}
                                          >
                                            I approve, apply
                                          </Button>
                                          <Button
                                            size="xs"
                                            variant="ghost"
                                            onClick={() => setConfirming(null)}
                                          >
                                            Cancel
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </li>
                                ),
                              )}
                            </ul>
                          )}

                          {severity === "ERROR" && editable && !issue.acknowledgement && (
                            <form
                              className="flex gap-1.5"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void acknowledge(issue);
                              }}
                            >
                              <Input
                                aria-label="Acknowledgement note"
                                placeholder="Accept as it is: why? (min 3 characters)"
                                className="h-7 text-xs"
                                value={notes[issue.id] ?? ""}
                                onChange={(e) =>
                                  setNotes((n) => ({ ...n, [issue.id]: e.target.value }))
                                }
                              />
                              <Button
                                size="xs"
                                type="submit"
                                variant="outline"
                                disabled={
                                  busy === `ack:${issue.id}` ||
                                  (notes[issue.id] ?? "").trim().length < 3
                                }
                              >
                                Acknowledge
                              </Button>
                            </form>
                          )}
                          {err && (
                            <p
                              role="alert"
                              className={cn(
                                "rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive",
                              )}
                            >
                              {err}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ),
      )}
    </section>
  );
}
