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
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex size-5 items-center justify-center rounded text-[11px] font-semibold",
          STATUS_CLASS[s.status],
        )}
      >
        {STATUS_CODE[s.status]}
      </span>
      <span className="text-xs">{STATUS_LABEL[s.status]}</span>
    </span>
  );
}

function IssueList({ issues, empty }: { issues: Issue[]; empty: string }) {
  if (issues.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {issues.map((i) => (
        <li key={i.id} className="flex items-start gap-2 text-sm">
          <SeverityBadge severity={i.severity} className="mt-0.5 shrink-0" />
          <span>{i.message}</span>
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
    <section className="space-y-4" aria-label={title} data-testid="change-diff">
      <h2 className="text-base font-semibold">{title}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Errors</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {data.errorsBefore} <span className="text-muted-foreground">to</span>{" "}
            <span
              className={
                worse
                  ? "text-red-700"
                  : data.errorsAfter < data.errorsBefore
                    ? "text-emerald-700"
                    : ""
              }
            >
              {data.errorsAfter}
            </span>
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Cells changed</dt>
          <dd className="text-lg font-semibold tabular-nums">{data.changedCells.length}</dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Issues added / resolved</dt>
          <dd className="text-lg font-semibold tabular-nums">
            +{added.length} / -{resolved.length}
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Weeks re-planned</dt>
          <dd className="text-lg font-semibold tabular-nums">{data.replannedWeeks.length}</dd>
          <dd className="text-[11px] text-muted-foreground">
            {data.replannedWeeks.length > 0
              ? `from ${data.replannedWeeks.map((w) => dayLabel(w)).join(", ")}`
              : "none"}
          </dd>
        </div>
      </dl>

      {data.affectedMonths.length > 0 && (
        <p
          role="alert"
          className="rounded-md border border-amber-400 bg-amber-50 p-2.5 text-sm text-amber-950"
        >
          This change also touches {data.affectedMonths.map(monthTitle).join(" and ")}. That roster
          is not re-planned from here: apply the same change there too.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-red-800">New issues ({added.length})</h3>
          <IssueList issues={added} empty="This change adds no issues." />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-emerald-800">Resolved ({resolved.length})</h3>
          <IssueList issues={resolved} empty="This change resolves nothing." />
        </div>
      </div>

      {data.suggestions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">How to resolve the new issues</h3>
          <ul className="space-y-1.5">
            {data.suggestions.slice(0, 8).map((s, i) => (
              <li key={i} className="rounded-md border p-2 text-sm">
                <span className="mr-1.5 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase">
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
        <h3 className="text-sm font-semibold">Changed cells ({cells.length})</h3>
        {cells.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cell changes.</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Person</th>
                  <th className="px-3 py-1.5 font-medium">Day</th>
                  <th className="px-3 py-1.5 font-medium">Before</th>
                  <th className="px-3 py-1.5 font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={`${c.employeeId}|${c.date}`} className="border-t">
                    <td className="px-3 py-1.5">{names.get(c.employeeId) ?? c.employeeId}</td>
                    <td className="px-3 py-1.5 tabular-nums">{dayLabel(c.date)}</td>
                    <td className="px-3 py-1.5">
                      <Pill s={c.before} />
                    </td>
                    <td className="px-3 py-1.5">
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
