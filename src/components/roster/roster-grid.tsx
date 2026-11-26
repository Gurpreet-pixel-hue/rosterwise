"use client";

import type { CoverageTable } from "@/engine/coverage";
import type { DraftEntry, Issue } from "@/engine/types";
import type { RosterRefs } from "@/server/pageData";
import {
  STATUS_CODE,
  STATUS_LABEL,
  cellKey,
  dayLabel,
  monthTitle,
  pendingLeaveOn,
  weekdayShort,
  worstSeverity,
} from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import { SEVERITY_DOT, STATUS_CLASS } from "./status-style";

export interface GridProps {
  month: string;
  window: string[];
  employees: RosterRefs["employees"];
  entries: Map<string, DraftEntry>;
  issuesByCell: Map<string, Issue[]>;
  refs: RosterRefs;
  /** date -> month whose roster owns it (cells that cannot be edited here). */
  foreignDates: Record<string, string>;
  brandProcesses: RosterRefs["brandProcesses"];
  coverage: CoverageTable;
  issuesByBpDay: Map<string, Issue[]>;
  selectedDate: string | null;
  selectedBp: string | null;
  highlight: { key: string } | null;
  onCell: (employeeId: string, date: string) => void;
  onDate: (date: string) => void;
  onStrip: (bpId: string, date: string) => void;
}

const COL = "w-8 min-w-8 max-w-8";

export function RosterGrid(p: GridProps) {
  const holidays = new Map(p.refs.holidays.map((h) => [h.date, h.name]));
  const podName = new Map(p.refs.pods.map((x) => [x.id, x.name]));
  const inMonth = (d: string) => d.slice(0, 7) === p.month;
  // month header groups
  const groups: Array<{ month: string; span: number }> = [];
  for (const d of p.window) {
    const m = d.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === m) last.span++;
    else groups.push({ month: m, span: 1 });
  }

  const dayHead = (d: string) => {
    const wd = weekdayShort(d);
    const weekend = wd === "SAT" || wd === "SUN";
    const holiday = holidays.get(d);
    return (
      <th
        key={d}
        scope="col"
        className={cn(
          COL,
          "border-b p-0 text-center font-normal",
          weekend && "bg-muted/60",
          !inMonth(d) && "bg-muted text-muted-foreground",
          p.selectedDate === d && "bg-primary/10",
        )}
      >
        <button
          type="button"
          onClick={() => p.onDate(d)}
          title={`${dayLabel(d)}${holiday ? ` · ${holiday}` : ""}${inMonth(d) ? "" : ` · belongs to ${monthTitle(d.slice(0, 7))}`}`}
          aria-label={`Select ${dayLabel(d)}`}
          className="flex w-full flex-col items-center py-1 leading-tight hover:bg-accent"
        >
          <span className="text-[10px] text-muted-foreground">{wd[0]}</span>
          <span className="text-xs font-medium tabular-nums">{Number(d.slice(8))}</span>
          <span className="h-2 text-[9px] text-emerald-700">{holiday ? "★" : ""}</span>
        </button>
      </th>
    );
  };

  return (
    <div
      className="max-h-[calc(100vh-15rem)] min-h-64 overflow-auto rounded-lg border bg-background"
      data-testid="roster-scroll"
    >
      <table className="w-max table-fixed border-separate border-spacing-0 text-xs">
        <colgroup>
          <col style={{ width: 190 }} />
          {p.window.map((d) => (
            <col key={d} style={{ width: 32 }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-20 bg-background">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-30 border-b bg-background px-2 text-left align-bottom"
              rowSpan={2}
            >
              <span className="text-[11px] font-medium text-muted-foreground">
                {p.employees.length} {p.employees.length === 1 ? "person" : "people"}
              </span>
            </th>
            {groups.map((g) => (
              <th
                key={g.month}
                colSpan={g.span}
                scope="colgroup"
                className={cn(
                  "border-b border-l px-1 text-left text-[11px] font-semibold",
                  g.month !== p.month && "text-muted-foreground",
                )}
              >
                {g.span > 2 ? monthTitle(g.month) : ""}
              </th>
            ))}
          </tr>
          <tr>{p.window.map(dayHead)}</tr>
        </thead>
        <tbody>
          {p.employees.map((emp) => (
            <tr key={emp.id} className="group">
              <th
                scope="row"
                className="sticky left-0 z-10 border-b bg-background px-2 py-0 text-left font-normal group-hover:bg-accent"
              >
                <div className="truncate text-xs font-medium leading-4">{emp.name}</div>
                <div className="truncate text-[10px] leading-3 text-muted-foreground">
                  {podName.get(emp.podId)}
                </div>
              </th>
              {p.window.map((d) => {
                const key = cellKey(emp.id, d);
                const e = p.entries.get(key);
                if (!e) return <td key={d} className={cn(COL, "border-b")} />;
                const issues = p.issuesByCell.get(key) ?? [];
                const sev = worstSeverity(issues.filter((i) => i.code !== "COMP_OFF_EARNED"));
                const pending = e.status === "WORK" && pendingLeaveOn(emp.id, d, p.refs);
                const foreign = p.foreignDates[d];
                const covering = e.coveredBrandProcessIds
                  .map((id) => {
                    const b = p.refs.brandProcesses.find((x) => x.id === id);
                    return b ? `${b.brandName} / ${b.processCode}` : id;
                  })
                  .join(", ");
                const title = [
                  `${emp.name}, ${dayLabel(d)}`,
                  STATUS_LABEL[e.status] + (covering ? `: ${covering}` : ""),
                  e.source === "MANUAL" ? "edited by hand" : "",
                  foreign ? `belongs to the ${monthTitle(foreign)} roster (read-only here)` : "",
                  pending ? "pending leave request (not applied)" : "",
                  ...issues
                    .filter((i) => i.code !== "COMP_OFF_EARNED")
                    .map((i) => `${i.severity}: ${i.code}`),
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <td
                    key={d}
                    className={cn(
                      COL,
                      "border-b p-0",
                      !inMonth(d) && "opacity-80",
                      p.selectedDate === d && "bg-primary/5",
                    )}
                  >
                    <button
                      type="button"
                      data-cell={key}
                      aria-label={title}
                      title={title}
                      onClick={() => p.onCell(emp.id, d)}
                      className={cn(
                        "relative flex h-7 w-8 items-center justify-center text-[11px] font-semibold outline-none transition-[filter] hover:brightness-95 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
                        STATUS_CLASS[e.status],
                        foreign && "border border-dashed border-slate-400",
                        p.highlight?.key === key && "z-10 ring-2 ring-primary ring-offset-1",
                      )}
                    >
                      {STATUS_CODE[e.status]}
                      {sev && (
                        <span
                          className={cn(
                            "absolute right-0.5 top-0.5 size-1.5 rounded-full",
                            SEVERITY_DOT[sev],
                          )}
                        />
                      )}
                      {pending && (
                        <span className="absolute bottom-0 left-0.5 text-[8px] font-bold leading-none text-amber-700">
                          p
                        </span>
                      )}
                      {e.source === "MANUAL" && (
                        <span className="absolute bottom-0.5 right-0.5 size-1 rounded-full bg-slate-700" />
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}

          <tr>
            <th
              scope="colgroup"
              colSpan={p.window.length + 1}
              className="sticky left-0 border-b bg-muted px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Coverage: people covering / people required, per brand and process
            </th>
          </tr>
          {p.brandProcesses.length === 0 && (
            <tr>
              <td colSpan={p.window.length + 1} className="px-2 py-3 text-muted-foreground">
                No brand rules in this view.
              </td>
            </tr>
          )}
          {p.brandProcesses.map((bp) => (
            <tr key={bp.id} className="group">
              <th
                scope="row"
                className="sticky left-0 z-10 border-b bg-background px-2 text-left font-normal group-hover:bg-accent"
              >
                <div className="truncate text-xs font-medium leading-4">{bp.brandName}</div>
                <div className="truncate text-[10px] leading-3 text-muted-foreground">
                  {bp.processCode} · {bp.shiftStart}-{bp.shiftEnd}
                </div>
              </th>
              {p.window.map((d) => {
                if (!inMonth(d)) return <td key={d} className={cn(COL, "border-b bg-muted/60")} />;
                const c = p.coverage[bp.id]?.[d];
                if (!c) return <td key={d} className={cn(COL, "border-b")} />;
                const short = c.required > 0 && c.covering < c.required;
                const issues = p.issuesByBpDay.get(cellKey(bp.id, d)) ?? [];
                const title =
                  c.required === 0
                    ? `${bp.brandName} / ${bp.processCode} does not operate on ${dayLabel(d)}`
                    : `${bp.brandName} / ${bp.processCode}, ${dayLabel(d)}: ${c.covering} of ${c.required} covering${short ? " (SHORT)" : ""}${issues.length > 0 ? ` · ${issues.map((i) => i.code).join(", ")}` : ""}`;
                return (
                  <td
                    key={d}
                    className={cn(COL, "border-b p-0", p.selectedDate === d && "bg-primary/5")}
                  >
                    <button
                      type="button"
                      data-strip={cellKey(bp.id, d)}
                      aria-label={title}
                      title={title}
                      onClick={() => p.onStrip(bp.id, d)}
                      className={cn(
                        "flex h-6 w-8 items-center justify-center text-[10px] tabular-nums outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring",
                        c.required === 0 && "bg-muted/70 text-muted-foreground/60",
                        c.required > 0 && !short && "text-emerald-800",
                        short && "bg-red-600 font-bold text-white",
                        p.highlight?.key === cellKey(bp.id, d) &&
                          "ring-2 ring-primary ring-offset-1",
                        p.selectedBp === bp.id && p.selectedDate === d && "ring-2 ring-primary",
                      )}
                    >
                      {c.required === 0 ? "–" : `${c.covering}/${c.required}`}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
