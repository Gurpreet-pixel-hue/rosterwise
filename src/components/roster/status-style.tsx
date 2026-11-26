import type { EntryStatus, Severity } from "@/engine/types";
import { STATUS_CODE, STATUS_LABEL } from "@/lib/roster-view";
import { cn } from "@/lib/utils";

/** Colour per status. Every cell also carries a letter code, so colour is never the only signal. */
export const STATUS_CLASS: Record<EntryStatus, string> = {
  WORK: "bg-white text-[#9A9CA3]",
  WEEKLY_OFF: "bg-[#E8F2FA] text-[#0C4A6E]",
  LEAVE: "bg-[#FDF3D7] text-[#854D0E]",
  COMP_OFF: "bg-[#F1ECFA] text-[#5B21B6]",
  HOLIDAY: "bg-[#E6F4EA] text-[#14532D]",
  UNAVAILABLE: "bg-[#FCE8E8] text-[#991B1B]",
};

export const SEVERITY_CLASS: Record<Severity, string> = {
  ERROR: "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]",
  WARNING: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
  INFO: "bg-[#F0F9FF] text-[#075985] border-[#BAE6FD]",
};

export const SEVERITY_DOT: Record<Severity, string> = {
  ERROR: "bg-[#B91C1C]",
  WARNING: "bg-[#D97706]",
  INFO: "bg-[#0284C7]",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
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
      className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground"
      aria-label="Legend"
    >
      {statuses.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-[3px] border border-border/80 font-mono text-[10px] font-semibold",
              STATUS_CLASS[s],
            )}
          >
            {STATUS_CODE[s]}
          </span>
          <span>{STATUS_LABEL[s]}</span>
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="relative inline-flex size-5 items-center justify-center rounded-[3px] border border-border/80 bg-white font-mono text-[10px] font-semibold text-[#6E717A]">
          W<span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-[#B91C1C]" />
        </span>
        <span>Issue</span>
      </li>
      <li className="flex items-center gap-1.5">
        <span className="relative inline-flex size-5 items-center justify-center rounded-[3px] border border-border/80 bg-white font-mono text-[10px] font-semibold text-[#6E717A]">
          W
          <span className="absolute bottom-0 left-0.5 text-[7px] font-bold leading-none text-[#A16207]">
            p
          </span>
        </span>
        <span>Pending leave</span>
      </li>
      <li className="flex items-center gap-1.5">
        <span className="relative inline-flex size-5 items-center justify-center rounded-[3px] border border-border/80 bg-white font-mono text-[10px] font-semibold text-[#6E717A]">
          W<span className="absolute bottom-0.5 right-0.5 size-1 rounded-full bg-[#18191B]" />
        </span>
        <span>Edited by hand</span>
      </li>
    </ul>
  );
}
