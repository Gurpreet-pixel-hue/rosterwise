"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Crosshair } from "lucide-react";
import {
  acknowledgeIssueAction,
  applySuggestionAction,
  explainIssueAction,
  removeAcknowledgementAction,
} from "@/server/actions/roster";
import type { IssueWithAck } from "@/server/services/roster";
import type { Suggestion } from "@/engine/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dayLabel, groupBySeverity, issueTarget } from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./status-style";

/** The explanation starts with the issue message and ends with "Options: ..."; show only the new rationale when structured suggestions are rendered below. */
function extra(
  explanation: string | undefined,
  message: string,
  hasStructuredSuggestions: boolean,
): string {
  if (!explanation) return "";
  let rest = explanation.startsWith(message) ? explanation.slice(message.length) : explanation;
  if (hasStructuredSuggestions) {
    const idx = rest.indexOf(" Options: ");
    if (idx !== -1) rest = rest.slice(0, idx);
  }
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
  names,
  emptyText,
  explanations,
  rosterId,
  editable,
  readOnlyReason,
  onJump,
  onDone,
}: {
  issues: IssueWithAck[];
  /** Readable names for ids in the approval text. */
  names?: { employee: (id: string) => string; bp: (id: string) => string };
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
  const [explained, setExplained] = useState<
    Record<string, { text: string; source: "ai" | "deterministic"; note?: string } | "loading">
  >({});

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
    });
    setBusy(null);
    if (!r.ok) return setError(issue.id, r.error.message);
    onDone("Acknowledged. The note is saved with the roster and the audit log.");
  }

  async function explain(issue: IssueWithAck) {
    setExplained((e) => ({ ...e, [issue.id]: "loading" }));
    setError(issue.id, null);
    const r = await explainIssueAction({ rosterId, issueId: issue.id });
    if (!r.ok) {
      setExplained((e) => {
        const n = { ...e };
        delete n[issue.id];
        return n;
      });
      return setError(issue.id, r.error.message);
    }
    setExplained((e) => ({ ...e, [issue.id]: r.data }));
  }

  async function withdraw(issue: IssueWithAck) {
    setBusy(`ack:${issue.id}`);
    const r = await removeAcknowledgementAction(rosterId, issue.id);
    setBusy(null);
    if (!r.ok) return setError(issue.id, r.error.message);
    onDone("Acknowledgement withdrawn.");
  }

  const groups = groupBySeverity(issues);

  return (
    <section aria-label="Issues" className="space-y-4">
      {!editable && readOnlyReason && (
        <p
          className="rounded-md border border-border bg-[#F8F8F5] p-2.5 text-xs text-foreground"
          role="note"
        >
          {readOnlyReason}
        </p>
      )}
      {issues.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      {groups.map(({ severity, issues: list }) =>
        list.length === 0 ? null : (
          <div key={severity}>
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b border-border pb-1.5 text-left"
              onClick={() => setOpen((o) => ({ ...o, [severity]: !o[severity] }))}
              aria-expanded={open[severity]}
            >
              {open[severity] ? (
                <ChevronDown className="size-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3.5 text-muted-foreground" />
              )}
              <SeverityBadge severity={severity} />
              <span className="font-mono text-xs font-semibold tabular-nums">{list.length}</span>
              {severity === "ERROR" && (
                <span className="text-xs text-muted-foreground">
                  block publishing until fixed or acknowledged
                </span>
              )}
            </button>
            {open[severity] && (
              <ul className="divide-y divide-border">
                {list.map((issue) => {
                  const isOpen =
                    expanded.has(issue.id) || (severity === "ERROR" && list.length <= 6);
                  const target = issueTarget(issue);
                  const err = errors[issue.id];
                  const actionableSuggestions = issue.suggestions.filter(
                    (s) => s.type !== "ACCEPT_GAP",
                  );
                  const rationale = extra(
                    explanations[issue.id],
                    issue.message,
                    actionableSuggestions.length > 0,
                  );

                  return (
                    <li key={issue.id} className="space-y-2 py-2.5" data-issue={issue.id}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                            <code className="font-mono text-[10.5px] text-foreground/80">
                              {issue.code}
                            </code>
                            {issue.date && (
                              <span className="font-mono tabular-nums">{dayLabel(issue.date)}</span>
                            )}
                            {issue.acknowledgement && (
                              <span className="rounded-[3px] border border-[#BBF7D0] bg-[#E6F4EA] px-1.5 py-0.5 text-[10px] font-medium text-[#14532D]">
                                Acknowledged
                              </span>
                            )}
                            {issue.changedSince && (
                              <span className="rounded-[3px] border border-[#FDE68A] bg-[#FDF3D7] px-1.5 py-0.5 text-[10px] font-medium text-[#854D0E]">
                                Changed since ack
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[13px] leading-snug text-foreground">
                            {issue.message}
                          </p>
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
                          {rationale && (
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {rationale}
                            </p>
                          )}
                          {
                            <div className="space-y-1.5">
                              {explained[issue.id] === undefined && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => explain(issue)}
                                  aria-label="Explain this issue in plain language"
                                >
                                  Explain
                                </Button>
                              )}
                              {explained[issue.id] === "loading" && (
                                <p className="text-xs text-muted-foreground" aria-live="polite">
                                  Explaining...
                                </p>
                              )}
                              {typeof explained[issue.id] === "object" && (
                                <div
                                  className="rounded-[4px] border border-border bg-muted/50 p-2 text-xs leading-relaxed"
                                  data-explanation={
                                    (explained[issue.id] as { source: string }).source
                                  }
                                >
                                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    {(explained[issue.id] as { source: string }).source === "ai"
                                      ? "AI explanation (written from this issue's text only)"
                                      : "Standard explanation"}
                                  </div>
                                  {(explained[issue.id] as { text: string }).text}
                                  {(explained[issue.id] as { note?: string }).note && (
                                    <div className="mt-1 text-[11px] text-muted-foreground">
                                      {(explained[issue.id] as { note?: string }).note}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          }
                          {issue.changedSince && (
                            <p className="rounded-[4px] border border-[#FDE68A] bg-[#FFFBEB] p-2 text-xs text-[#854D0E]">
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
                                  className="font-medium text-primary underline"
                                  disabled={busy === `ack:${issue.id}`}
                                  onClick={() => withdraw(issue)}
                                >
                                  Withdraw
                                </button>
                              )}
                            </p>
                          )}

                          {actionableSuggestions.length > 0 && (
                            <ul className="space-y-1.5">
                              {issue.suggestions.map((s, i) =>
                                s.type === "ACCEPT_GAP" ? null : (
                                  <li
                                    key={i}
                                    className="rounded-md border border-border bg-[#F8F8F5] px-2.5 py-2"
                                  >
                                    <div className="flex items-start gap-2">
                                      <div className="min-w-0 flex-1 text-xs leading-snug text-foreground">
                                        <span className="mr-1.5 inline-block rounded-[3px] border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-foreground">
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
                                      <div className="mt-2 space-y-2 rounded-[4px] border border-[#FDE68A] bg-[#FFFBEB] p-2 text-xs text-[#854D0E]">
                                        <p>
                                          This adds a <strong>permanent</strong> assignment:{" "}
                                          {s
                                            .temporaryAssignments!.map(
                                              (a) =>
                                                `${names?.employee(a.employeeId) ?? a.employeeId} as ${a.role.toLowerCase()} on ${names?.bp(a.brandProcessId) ?? a.brandProcessId} (${a.allocationPct}%)`,
                                            )
                                            .join("; ")}
                                          . It stays after this roster and changes future months
                                          until you remove it in Setup, Assignments (the row is
                                          noted &ldquo;Added from roster...&rdquo;).
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
                                "rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] p-2 text-xs text-[#991B1B]",
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
