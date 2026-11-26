"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CoverageTable } from "@/engine/coverage";
import type { DraftEntry } from "@/engine/types";
import type { RosterRefs } from "@/server/pageData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_CODE, STATUS_LABEL, dayLabel, whoIsWorking } from "@/lib/roster-view";
import { addDays } from "@/engine/calendar";
import { cn } from "@/lib/utils";
import { STATUS_CLASS } from "./status-style";

export function WhoWorking({
  date,
  window: dates,
  entries,
  refs,
  employeeIds,
  coverage,
  selectedBp,
  scopeLabel,
  onDate,
}: {
  date: string;
  window: string[];
  entries: DraftEntry[];
  refs: RosterRefs;
  /** The people the current view is about; the panel lists only them. */
  employeeIds: Set<string>;
  coverage: CoverageTable;
  selectedBp: string | null;
  scopeLabel: string;
  onDate: (d: string) => void;
}) {
  const panel = whoIsWorking(date, entries, refs);
  const keep = <T extends { employeeId: string }>(rows: T[]) =>
    rows.filter((r) => employeeIds.has(r.employeeId));
  const working = keep(panel.working);
  const bench = keep(panel.bench);
  const off = keep(panel.off);
  const bp = selectedBp ? refs.brandProcesses.find((b) => b.id === selectedBp) : undefined;
  const cell = bp ? coverage[bp.id]?.[date] : undefined;
  const nameOf = new Map(refs.employees.map((e) => [e.id, e.name]));
  const first = dates[0];
  const last = dates[dates.length - 1];

  return (
    <section aria-label="Who is working" className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Previous day"
          disabled={date <= first}
          onClick={() => onDate(addDays(date, -1))}
        >
          <ChevronLeft />
        </Button>
        <Input
          type="date"
          aria-label="Date"
          value={date}
          min={first}
          max={last}
          className="h-7 w-auto"
          onChange={(e) => e.target.value && onDate(e.target.value)}
        />
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Next day"
          disabled={date >= last}
          onClick={() => onDate(addDays(date, 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      <div>
        <h3 className="text-sm font-semibold">Who&apos;s working on {dayLabel(date)}</h3>
        <p className="text-xs text-muted-foreground">
          {panel.holiday ? `Public holiday: ${panel.holiday}. ` : ""}
          Showing: {scopeLabel}
        </p>
      </div>

      {bp && cell && (
        <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
          <div className="font-medium">
            {bp.brandName} / {bp.processCode}:{" "}
            {cell.required === 0
              ? "not operating"
              : `${cell.covering} of ${cell.required} covering`}
          </div>
          {cell.coverers.length > 0 && (
            <div className="mt-0.5 text-muted-foreground">
              Covered by {cell.coverers.map((id) => nameOf.get(id) ?? id).join(", ")}
            </div>
          )}
        </div>
      )}

      <Group
        title={`Working (${working.length})`}
        empty="Nobody in this view is covering a brand today."
      >
        {working.map((r) => (
          <li key={r.employeeId} className="flex items-start gap-2 py-1">
            <Chip status="WORK" />
            <div className="min-w-0">
              <div className="text-sm leading-tight">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.covering.join(", ")}</div>
            </div>
          </li>
        ))}
      </Group>
      <Group
        title={`Available, covering nothing (${bench.length})`}
        hint="The backup pool: working today, not needed by any brand's minimum."
        empty="Nobody."
      >
        {bench.map((r) => (
          <li key={r.employeeId} className="flex items-center gap-2 py-1">
            <Chip status="WORK" />
            <span className="text-sm">{r.name}</span>
          </li>
        ))}
      </Group>
      <Group title={`Off (${off.length})`} empty="Nobody.">
        {off.map((r) => (
          <li key={r.employeeId} className="flex items-center gap-2 py-1">
            <Chip status={r.status} />
            <span className="text-sm">{r.name}</span>
            <span className="text-xs text-muted-foreground">{STATUS_LABEL[r.status]}</span>
          </li>
        ))}
      </Group>
    </section>
  );
}

function Chip({ status }: { status: DraftEntry["status"] }) {
  return (
    <span
      className={cn(
        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold",
        STATUS_CLASS[status],
      )}
      aria-hidden
    >
      {STATUS_CODE[status]}
    </span>
  );
}

function Group({
  title,
  hint,
  empty,
  children,
}: {
  title: string;
  hint?: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <div>
      <h4 className="border-b pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {hint && <p className="pt-1 text-xs text-muted-foreground">{hint}</p>}
      {children.length === 0 ? (
        <p className="py-1.5 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-transparent">{children}</ul>
      )}
    </div>
  );
}
