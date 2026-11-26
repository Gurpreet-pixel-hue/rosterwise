"use client";

import { useState } from "react";
import type { CellChange } from "@/engine/diff";
import type { Issue, IssueDelta, Suggestion } from "@/engine/types";
import type { RosterRefs } from "@/server/pageData";
import { Button } from "@/components/ui/button";
import { STATUS_CODE, STATUS_LABEL, dayLabel, monthTitle } from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import { SeverityBadge, STATUS_CLASS } from "./status-style";

export interface DiffData {
  changedCells: CellChange[];
  issueDelta: IssueDelta;
  suggestions: Suggestion[];
  replannedWeeks: string[];
  errorsBefore: number;
  errorsAfter: number;
  affectedMonths: string[];
}

function Pill({
  s,
}: {
  s?: { status: keyof typeof STATUS_CODE; coveredBrandProcessIds: string[] };
}) {
  if (!s) return <span className="text-muted-foreground">none</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-[3px] border border-border/80 font-mono text-[10.5px] font-semibold",
          STATUS_CLASS[s.status],
        )}
      >
        {STATUS_CODE[s.status]}
      </span>
      <span className="text-xs text-foreground">{STATUS_LABEL[s.status]}</span>
    </span>
  );
}

function IssueList({ issues, empty }: { issues: Issue[]; empty: string }) {
  if (issues.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border border-t border-border">
      {issues.map((i) => (
        <li key={i.id} className="flex items-start gap-2 py-2 text-[13px] leading-snug">
          <SeverityBadge severity={i.severity} className="mt-0.5 shrink-0" />
          <span className="text-foreground">{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a change did (or would do): errors before and after, changed cells, issues added and resolved. */
export function ChangeDiff({
  title,
  data,
  refs,
  month,
}: {
  title: string;
  data: DiffData;
  refs: RosterRefs;
  month: string;
}) {
  const [all, setAll] = useState(false);
  const names = new Map(refs.employees.map((e) => [e.id, e.name]));
  const cells = [...data.changedCells].sort(
    (a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId),
  );
  const shown = all ? cells : cells.slice(0, 40);
  const added = data.issueDelta.added.filter((i) => i.code !== "COMP_OFF_EARNED");
  const resolved = data.issueDelta.resolved.filter((i) => i.code !== "COMP_OFF_EARNED");
  const worse = data.errorsAfter > data.errorsBefore;

  return (
    <section className="space-y-5" aria-label={title} data-testid="change-diff">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>

      {/* Horizontal ledger strip */}
      <dl className="grid grid-cols-2 divide-y divide-border border-y border-border bg-card sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="px-3.5 py-3">
          <dt className="text-xs text-muted-foreground">Errors</dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {data.errorsBefore}{" "}
            <span className="font-sans text-xs font-normal text-muted-foreground">to</span>{" "}
            <span
              className={
                worse
                  ? "text-[#B91C1C]"
                  : data.errorsAfter < data.errorsBefore
                    ? "text-[#14532D]"
                    : "text-foreground"
              }
            >
              {data.errorsAfter}
            </span>
          </dd>
        </div>
        <div className="px-3.5 py-3">
          <dt className="text-xs text-muted-foreground">Cells changed</dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
            {data.changedCells.length}
          </dd>
        </div>
        <div className="px-3.5 py-3">
          <dt className="text-xs text-muted-foreground">Issues added / resolved</dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
            +{added.length} / -{resolved.length}
          </dd>
        </div>
        <div className="px-3.5 py-3">
          <dt className="text-xs text-muted-foreground">Weeks re-planned</dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
            {data.replannedWeeks.length}
          </dd>
          <dd className="font-mono text-[11px] text-muted-foreground">
            {data.replannedWeeks.length > 0
              ? `from ${data.replannedWeeks.map((w) => dayLabel(w)).join(", ")}`
              : "none"}
          </dd>
        </div>
      </dl>

      {data.affectedMonths.length > 0 && (
        <p
          role="alert"
          className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-2.5 text-sm text-[#854D0E]"
        >
          This change also touches {data.affectedMonths.map(monthTitle).join(" and ")}. That roster
          is not re-planned from here: apply the same change there too.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#991B1B]">New issues ({added.length})</h3>
          <IssueList issues={added} empty="This change adds no issues." />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#14532D]">Resolved ({resolved.length})</h3>
          <IssueList issues={resolved} empty="This change resolves nothing." />
        </div>
      </div>

      {data.suggestions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">How to resolve the new issues</h3>
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {data.suggestions.slice(0, 8).map((s, i) => (
              <li key={i} className="px-3 py-2 text-[13px] leading-snug">
                <span className="mr-2 inline-block rounded-[3px] border border-border bg-[#F8F8F5] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-foreground">
                  {s.type.replaceAll("_", " ")}
                </span>
                {s.description}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            After applying, open the roster ({monthTitle(month)}): each suggestion is one click
            there.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Changed cells ({cells.length})</h3>
        {cells.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cell changes.</p>
        ) : (
          <div className="max-h-[clamp(16rem,42dvh,34rem)] overflow-auto rounded-md border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-border bg-[#F4F3EE] text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 font-medium">Day</th>
                  <th className="px-3 py-2 font-medium">Before</th>
                  <th className="px-3 py-2 font-medium">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((c) => (
                  <tr key={`${c.employeeId}|${c.date}`} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {names.get(c.employeeId) ?? c.employeeId}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {dayLabel(c.date)}
                    </td>
                    <td className="px-3 py-2">
                      <Pill s={c.before} />
                    </td>
                    <td className="px-3 py-2">
                      <Pill s={c.after} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cells.length > 40 && (
          <Button size="sm" variant="ghost" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${cells.length}`}
          </Button>
        )}
      </div>
    </section>
  );
}
