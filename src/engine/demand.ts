import { isOperating, weekdayOf } from "./calendar";
import type { BrandProcessDemandInput, CoverageOverrideInput } from "./types";

export interface DemandContext {
  holidays: ReadonlySet<string>;
  /** Built with indexOverrides(). */
  overrides: ReadonlyMap<string, number>;
}

export const overrideKey = (brandProcessId: string, date: string) => `${brandProcessId}|${date}`;

export function indexOverrides(overrides: readonly CoverageOverrideInput[]): Map<string, number> {
  return new Map(overrides.map((o) => [overrideKey(o.brandProcessId, o.date), o.minStaff]));
}

/**
 * Required staff for a brand-process on a date.
 * Resolution order: CoverageOverride(bp, date) -> weekdayMinStaff[weekday] -> defaultMinStaff,
 * and only if the brand-process operates that day; otherwise 0. An explicit 0 at any level wins.
 */
export function requiredStaff(
  bp: BrandProcessDemandInput,
  date: string,
  ctx: DemandContext,
): number {
  if (!isOperating(bp, date, ctx.holidays)) return 0;
  return (
    ctx.overrides.get(overrideKey(bp.id, date)) ??
    bp.weekdayMinStaff?.[weekdayOf(date)] ??
    bp.defaultMinStaff
  );
}

/** Demand for every brand-process on every requested date: Map<bpId, Map<date, required>>. */
export function expandDemand(
  bps: readonly BrandProcessDemandInput[],
  dates: readonly string[],
  ctx: DemandContext,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const bp of bps) {
    out.set(bp.id, new Map(dates.map((d) => [d, requiredStaff(bp, d, ctx)])));
  }
  return out;
}
