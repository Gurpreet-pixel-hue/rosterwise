"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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

const COL = "min-w-[var(--day-min)]";

export function RosterGrid(p: GridProps) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [collapsedPods, setCollapsedPods] = useState<Set<string>>(() => new Set());
  const [onlyShort, setOnlyShort] = useState(false);

  const holidays = useMemo(
    () => new Map(p.refs.holidays.map((h) => [h.date, h.name])),
    [p.refs.holidays],
  );
  const podName = useMemo(() => new Map(p.refs.pods.map((x) => [x.id, x.name])), [p.refs.pods]);
  const inMonth = (d: string) => d.slice(0, 7) === p.month;
  const isMonday = (d: string) => weekdayShort(d) === "MON";

  // month header groups
  const groups: Array<{ month: string; span: number }> = [];
  for (const d of p.window) {
    const m = d.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === m) last.span++;
    else groups.push({ month: m, span: 1 });
  }

  // Group employees by pod when more than one pod is visible in the grid
  const podGroups = useMemo(() => {
    const map = new Map<string, RosterRefs["employees"]>();
    for (const emp of p.employees) {
      const list = map.get(emp.podId);
      if (list) list.push(emp);
      else map.set(emp.podId, [emp]);
    }
    return [...map.entries()].map(([podId, members]) => ({
      podId,
      name: podName.get(podId) ?? podId,
      members,
    }));
  }, [p.employees, podName]);

  const showPodHeaders = podGroups.length > 1;

  const shortBpIds = useMemo(() => {
    const set = new Set<string>();
    for (const bp of p.brandProcesses) {
      for (const d of p.window) {
        if (d.slice(0, 7) !== p.month) continue;
        const c = p.coverage[bp.id]?.[d];
        if (c && c.required > 0 && c.covering < c.required) {
          set.add(bp.id);
          break;
        }
      }
    }
    return set;
  }, [p.brandProcesses, p.window, p.coverage, p.month]);

  const shownBrandProcesses =
    onlyShort && shortBpIds.size > 0
      ? p.brandProcesses.filter((bp) => shortBpIds.has(bp.id))
      : p.brandProcesses;

  const togglePod = (podId: string) => {
    setCollapsedPods((prev) => {
      const next = new Set(prev);
      if (next.has(podId)) next.delete(podId);
      else next.add(podId);
      return next;
    });
  };

  const dayHead = (d: string) => {
    const wd = weekdayShort(d);
    const weekend = wd === "SAT" || wd === "SUN";
    const holiday = holidays.get(d);
    const mon = wd === "MON";
    const selected = p.selectedDate === d;
    const hovered = hoveredDate === d;
    return (
      <th
        key={d}
        scope="col"
        onMouseEnter={() => setHoveredDate(d)}
        onMouseLeave={() => setHoveredDate(null)}
        className={cn(
          COL,
          "border-b border-r border-border p-0 text-center font-normal bg-card",
          mon && "border-l-2 border-l-[#C8C7BE]",
          weekend && "bg-[#F4F3EE]",
          !inMonth(d) && "bg-[#EFECE5] text-muted-foreground",
          hovered && "bg-primary/[0.05]",
          selected && "bg-primary/[0.08] border-b-2 border-b-primary",
        )}
      >
        <button
          type="button"
          onClick={() => p.onDate(d)}
          title={`${dayLabel(d)}${holiday ? ` · ${holiday}` : ""}${inMonth(d) ? "" : ` · belongs to ${monthTitle(d.slice(0, 7))}`}`}
          aria-label={`Select ${dayLabel(d)}`}
          className="flex w-full flex-col items-center py-1 leading-tight transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="text-[9.5px] font-medium text-muted-foreground">{wd[0]}</span>
          <span
            className={cn(
              "font-mono text-[11px] font-medium tabular-nums",
              selected && "font-semibold text-primary",
            )}
          >
            {Number(d.slice(8))}
          </span>
          <span className="flex h-2 items-center justify-center">
            {holiday && (
              <span
                className="size-1.5 rounded-full bg-[#14532D]"
                title={holiday}
                aria-hidden="true"
              />
            )}
          </span>
        </button>
      </th>
    );
  };

  const renderEmployeeRow = (emp: RosterRefs["employees"][number]) => (
    <tr key={emp.id} className="group">
      <th
        scope="row"
        className="sticky left-0 z-10 border-b border-r border-border bg-card px-2.5 py-0 text-left font-normal transition-colors group-hover:bg-[#F4F3EE]"
      >
        <div className="truncate text-xs font-medium leading-4 text-foreground">{emp.name}</div>
        {!showPodHeaders && (
          <div className="truncate text-[10px] leading-3 text-muted-foreground">
            {podName.get(emp.podId)}
          </div>
        )}
      </th>
      {p.window.map((d) => {
        const key = cellKey(emp.id, d);
        const e = p.entries.get(key);
        const mon = isMonday(d);
        const wd = weekdayShort(d);
        const weekend = wd === "SAT" || wd === "SUN";
        const hovered = hoveredDate === d;
        const selected = p.selectedDate === d;
        if (!e) {
          return (
            <td
              key={d}
              className={cn(
                COL,
                "border-b border-r border-border/70 bg-card",
                mon && "border-l-2 border-l-[#C8C7BE]",
              )}
            />
          );
        }
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
            onMouseEnter={() => setHoveredDate(d)}
            onMouseLeave={() => setHoveredDate(null)}
            className={cn(
              COL,
              "border-b border-r border-border/70 p-0",
              mon && "border-l-2 border-l-[#C8C7BE]",
              !inMonth(d) && "opacity-85",
              selected && "bg-primary/[0.06]",
            )}
          >
            <button
              type="button"
              data-cell={key}
              aria-label={title}
              title={title}
              onClick={() => p.onCell(emp.id, d)}
              className={cn(
                "relative flex h-[var(--cell-h)] w-full items-center justify-center font-mono text-[length:var(--cell-fs)] font-semibold outline-none transition-colors hover:brightness-[0.96] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                STATUS_CLASS[e.status],
                e.status === "WORK" && weekend && "bg-[#F8F8F4]",
                e.status === "WORK" && !inMonth(d) && "bg-[#F2F1EC]",
                hovered && e.status === "WORK" && "bg-primary/[0.05]",
                foreign && "outline-1 -outline-offset-2 outline-dashed outline-[#B8B6AC]",
                p.highlight?.key === key && "z-10 ring-2 ring-inset ring-primary",
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
                <span className="absolute bottom-0 left-0.5 text-[8px] font-bold leading-none text-[#A16207]">
                  p
                </span>
              )}
              {e.source === "MANUAL" && (
                <span className="absolute bottom-0.5 right-0.5 size-1 rounded-full bg-[#18191B]" />
              )}
            </button>
          </td>
        );
      })}
    </tr>
  );

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Monthly roster schedule"
      className="roster-grid-scroll min-h-64 flex-1 overflow-auto bg-card outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:min-h-0"
      data-testid="roster-scroll"
    >
      <table
        className="roster-grid-table w-full table-fixed border-separate border-spacing-0 text-xs"
        style={{ minWidth: `calc(var(--emp-col) + ${p.window.length} * var(--day-min))` }}
      >
        <colgroup>
          <col style={{ width: "var(--emp-col)" }} />
          {p.window.map((d) => (
            <col key={d} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-30 border-b border-r border-border bg-[#F4F3EE] px-2.5 py-1.5 text-left align-bottom"
              rowSpan={2}
            >
              <span className="font-mono text-[11px] font-medium text-muted-foreground">
                {p.employees.length} {p.employees.length === 1 ? "person" : "people"}
              </span>
            </th>
            {groups.map((g, gi) => (
              <th
                key={g.month}
                colSpan={g.span}
                scope="colgroup"
                className={cn(
                  "border-b border-r border-border bg-card px-1.5 py-1 text-left text-[11px] font-semibold text-foreground",
                  gi > 0 && "border-l-2 border-l-[#C8C7BE]",
                  g.month !== p.month && "bg-[#EFECE5] text-muted-foreground",
                )}
              >
                {g.span >= 5
                  ? monthTitle(g.month)
                  : g.span >= 2
                    ? `${monthTitle(g.month).slice(0, 3)} '${g.month.slice(2, 4)}`
                    : ""}
              </th>
            ))}
          </tr>
          <tr>{p.window.map(dayHead)}</tr>
        </thead>
        <tbody>
          {showPodHeaders
            ? podGroups.map((grp) => {
                const collapsed = collapsedPods.has(grp.podId);
                return (
                  <Fragment key={grp.podId}>
                    <tr className="bg-[#F3F2EC]">
                      <td
                        colSpan={p.window.length + 1}
                        className="sticky left-0 border-b border-border px-2 py-1 text-left"
                      >
                        <button
                          type="button"
                          onClick={() => togglePod(grp.podId)}
                          aria-expanded={!collapsed}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground hover:text-primary"
                        >
                          {collapsed ? (
                            <ChevronRight className="size-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="size-3.5 text-muted-foreground" />
                          )}
                          <span>{grp.name}</span>
                          <span className="font-mono font-normal text-muted-foreground">
                            ({grp.members.length})
                          </span>
                        </button>
                      </td>
                    </tr>
                    {!collapsed && grp.members.map(renderEmployeeRow)}
                  </Fragment>
                );
              })
            : p.employees.map(renderEmployeeRow)}

          <tr>
            <td
              colSpan={p.window.length + 1}
              className="sticky left-0 border-y border-border bg-[#F0EFEA] px-2.5 py-1.5 text-left"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Coverage: people covering / required, per brand and process
                </span>
                {p.brandProcesses.length > 4 && shortBpIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setOnlyShort((v) => !v)}
                    className={cn(
                      "rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors",
                      onlyShort
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {onlyShort
                      ? `Showing short (${shortBpIds.size})`
                      : `Only short (${shortBpIds.size})`}
                  </button>
                )}
              </div>
            </td>
          </tr>
          {shownBrandProcesses.length === 0 && (
            <tr>
              <td colSpan={p.window.length + 1} className="px-2.5 py-3 text-muted-foreground">
                No brand rules in this view.
              </td>
            </tr>
          )}
          {shownBrandProcesses.map((bp) => (
            <tr key={bp.id} className="group">
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-r border-border bg-card px-2.5 py-0.5 text-left font-normal transition-colors group-hover:bg-[#F4F3EE]"
              >
                <div className="truncate text-xs font-medium leading-4 text-foreground">
                  {bp.brandName}
                </div>
                <div className="truncate font-mono text-[10px] leading-3 text-muted-foreground">
                  {bp.processCode} · {bp.shiftStart}-{bp.shiftEnd}
                </div>
              </th>
              {p.window.map((d) => {
                const mon = isMonday(d);
                if (!inMonth(d)) {
                  return (
                    <td
                      key={d}
                      className={cn(
                        COL,
                        "border-b border-r border-border/70 bg-[#EFECE5] text-center font-mono text-[10px] text-muted-foreground/60",
                        mon && "border-l-2 border-l-[#C8C7BE]",
                      )}
                    >
                      –
                    </td>
                  );
                }
                const c = p.coverage[bp.id]?.[d];
                if (!c) {
                  return (
                    <td
                      key={d}
                      className={cn(
                        COL,
                        "border-b border-r border-border/70 bg-card",
                        mon && "border-l-2 border-l-[#C8C7BE]",
                      )}
                    />
                  );
                }
                const short = c.required > 0 && c.covering < c.required;
                const issues = p.issuesByBpDay.get(cellKey(bp.id, d)) ?? [];
                const hovered = hoveredDate === d;
                const title =
                  c.required === 0
                    ? `${bp.brandName} / ${bp.processCode} does not operate on ${dayLabel(d)}`
                    : `${bp.brandName} / ${bp.processCode}, ${dayLabel(d)}: ${c.covering} of ${c.required} covering${short ? " (SHORT)" : ""}${issues.length > 0 ? ` · ${issues.map((i) => i.code).join(", ")}` : ""}`;
                return (
                  <td
                    key={d}
                    onMouseEnter={() => setHoveredDate(d)}
                    onMouseLeave={() => setHoveredDate(null)}
                    className={cn(
                      COL,
                      "border-b border-r border-border/70 p-0",
                      mon && "border-l-2 border-l-[#C8C7BE]",
                      p.selectedDate === d && "bg-primary/[0.06]",
                    )}
                  >
                    <button
                      type="button"
                      data-strip={cellKey(bp.id, d)}
                      aria-label={title}
                      title={title}
                      onClick={() => p.onStrip(bp.id, d)}
                      className={cn(
                        "flex h-[var(--cell-h)] w-full items-center justify-center font-mono text-[10px] tabular-nums outline-none transition-colors hover:brightness-95 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        c.required === 0 && "bg-[#F4F3EE] text-[#9A9CA3]",
                        c.required > 0 && !short && "bg-card text-[#14532D]",
                        c.required > 0 && !short && hovered && "bg-primary/[0.05]",
                        short && "bg-[#B91C1C] font-semibold text-white",
                        p.highlight?.key === cellKey(bp.id, d) &&
                          "z-10 ring-2 ring-inset ring-primary",
                        p.selectedBp === bp.id &&
                          p.selectedDate === d &&
                          "z-10 ring-2 ring-inset ring-primary",
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
