import type { EntryStatus, Severity } from "@/engine/types";
import { STATUS_CODE, STATUS_LABEL } from "@/lib/roster-view";
import { cn } from "@/lib/utils";

/** Colour per status. Every cell also carries a letter code, so colour is never the only signal. */
export const STATUS_CLASS: Record<EntryStatus, string> = {
  WORK: "bg-slate-100 text-slate-700",
  WEEKLY_OFF: "bg-sky-200 text-sky-950",
  LEAVE: "bg-amber-200 text-amber-950",
  COMP_OFF: "bg-violet-200 text-violet-950",
  HOLIDAY: "bg-emerald-200 text-emerald-950",
  UNAVAILABLE: "bg-rose-200 text-rose-950",
};

export const SEVERITY_CLASS: Record<Severity, string> = {
  ERROR: "bg-red-100 text-red-900 border-red-300",
  WARNING: "bg-amber-100 text-amber-900 border-amber-300",
  INFO: "bg-sky-100 text-sky-900 border-sky-300",
};

export const SEVERITY_DOT: Record<Severity, string> = {
  ERROR: "bg-red-600",
  WARNING: "bg-amber-500",
  INFO: "bg-sky-500",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        SEVERITY_CLASS[severity],
        className,
      )}
    >
      {severity}
    </span>
  );
}

export function Legend() {
  const statuses = Object.keys(STATUS_CODE) as EntryStatus[];
  return (
    <ul
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="Legend"
    >
      {statuses.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex size-5 items-center justify-center rounded text-[11px] font-semibold",
              STATUS_CLASS[s],
            )}
          >
            {STATUS_CODE[s]}
          </span>
          {STATUS_LABEL[s]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="relative inline-flex size-5 items-center justify-center rounded bg-slate-100 text-[11px] font-semibold text-slate-700">
          W<span className="absolute right-0 top-0 size-1.5 rounded-full bg-red-600" />
        </span>
        Issue on that day
      </li>
      <li className="flex items-center gap-1.5">
        <span className="relative inline-flex size-5 items-center justify-center rounded bg-slate-100 text-[11px] font-semibold text-slate-700">
          W
          <span className="absolute bottom-0 left-0 text-[8px] font-bold leading-none text-amber-700">
            p
          </span>
        </span>
        Pending leave (not applied)
      </li>
      <li className="flex items-center gap-1.5">
        <span className="relative inline-flex size-5 items-center justify-center rounded bg-slate-100 text-[11px] font-semibold text-slate-700">
          W<span className="absolute bottom-0 right-0 size-1 rounded-full bg-slate-700" />
        </span>
        Edited by hand
      </li>
    </ul>
  );
}
