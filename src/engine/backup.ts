// Backup recommendations (CLAUDE.md P5.1). For every brand-process: who covers it, whether it is exposed (one
// absence leaves it short, with nobody behind the primary), and who could be added as a backup, ranked. Pure
// and deterministic; the UI shows it on the brand view with a one-click "add as backup".
import { buildCtx, type Ctx } from "./ctx";
import type { EngineBrandProcess, EngineInput } from "./types";

/** The share of a day a new backup assignment takes unless the person has less spare. */
export const DEFAULT_BACKUP_PCT = 20;

export type BackupStatus =
  /** At least one BACKUP assignment exists. */
  | "COVERED_BY_BACKUP"
  /** No backup, and the primaries are no more than the most the brand-process ever needs: any absence is a gap. */
  | "EXPOSED"
  /** No backup, but more primaries than the peak requirement, so an absence can be absorbed. */
  | "SHARED"
  /** Nobody is assigned at all. */
  | "NO_STAFF";

export interface PersonShare {
  employeeId: string;
  name: string;
  allocationPct: number;
}

export interface BackupCandidate {
  employeeId: string;
  name: string;
  samePod: boolean;
  /** Their existing allocation: the sum of allocationPct over everything they are assigned to. */
  loadPct: number;
  /** What a new assignment would take (DEFAULT_BACKUP_PCT, or less if that is all they have spare). */
  suggestedPct: number;
  reason: string;
}

export interface BackupReport {
  brandProcessId: string;
  brandName: string;
  processCode: string;
  status: BackupStatus;
  primaries: PersonShare[];
  backups: PersonShare[];
  /** The most people this brand-process ever needs on one day (default, weekday minimums, overrides). */
  peakRequired: number;
  candidates: BackupCandidate[];
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function peakRequired(ctx: Ctx, bp: EngineBrandProcess): number {
  let peak = 0;
  for (const d of ctx.demand.get(bp.id)?.values() ?? []) peak = Math.max(peak, d);
  return peak;
}

/** Hours between the earliest start and latest end of the shifts, i.e. the span of that person's day. */
function spanMinutes(shifts: ReadonlyArray<readonly [number, number]>): number {
  if (shifts.length === 0) return 0;
  return Math.max(...shifts.map((s) => s[1])) - Math.min(...shifts.map((s) => s[0]));
}

export function backupReport(input: EngineInput, perBrandProcess = 3): BackupReport[] {
  const ctx = buildCtx(input);
  const empById = new Map(input.employees.map((e) => [e.id, e]));
  const bpById = new Map(input.brandProcesses.map((b) => [b.id, b]));
  const assignedTo = new Map<string, typeof input.assignments>();
  for (const a of input.assignments) {
    const list = assignedTo.get(a.employeeId) ?? [];
    list.push(a);
    assignedTo.set(a.employeeId, list);
  }
  const share = (a: (typeof input.assignments)[number]): PersonShare => ({
    employeeId: a.employeeId,
    name: empById.get(a.employeeId)?.name ?? a.employeeId,
    allocationPct: a.allocationPct,
  });
  const byName = (a: PersonShare, b: PersonShare) =>
    a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId);

  const out: BackupReport[] = [];
  for (const bp of [...input.brandProcesses].sort(
    (a, b) => a.brandName.localeCompare(b.brandName) || a.processCode.localeCompare(b.processCode),
  )) {
    const here = input.assignments.filter((a) => a.brandProcessId === bp.id);
    const primaries = here
      .filter((a) => a.role === "PRIMARY")
      .map(share)
      .sort(byName);
    const backups = here
      .filter((a) => a.role === "BACKUP")
      .map(share)
      .sort(byName);
    const peak = peakRequired(ctx, bp);
    let status: BackupStatus;
    if (here.length === 0) status = "NO_STAFF";
    else if (backups.length > 0) status = "COVERED_BY_BACKUP";
    else if (primaries.length <= peak) status = "EXPOSED";
    else status = "SHARED";

    const candidates: BackupCandidate[] = [];
    if (status === "EXPOSED" || status === "NO_STAFF") {
      const mine = new Set(here.map((a) => a.employeeId));
      const thisShift = [minutes(bp.shiftStart), minutes(bp.shiftEnd)] as const;
      const ranked: Array<BackupCandidate & { sortLoad: number }> = [];
      for (const emp of input.employees) {
        if (!emp.isActive || mine.has(emp.id)) continue;
        const theirs = assignedTo.get(emp.id) ?? [];
        const load = theirs.reduce((n, a) => n + a.allocationPct, 0);
        const spare = 100 - load;
        if (spare < 1) continue;
        const shifts = theirs
          .map((a) => bpById.get(a.brandProcessId))
          .filter((b): b is EngineBrandProcess => b !== undefined)
          .map((b) => [minutes(b.shiftStart), minutes(b.shiftEnd)] as const);
        // their whole day with this shift added must fit in their maximum daily hours
        if (spanMinutes([...shifts, thisShift]) > emp.maxDailyHours * 60) continue;
        const samePod = emp.podId === bp.brandPodId;
        const pct = Math.min(DEFAULT_BACKUP_PCT, spare);
        ranked.push({
          employeeId: emp.id,
          name: emp.name,
          samePod,
          loadPct: load,
          suggestedPct: pct,
          sortLoad: load,
          reason: `${samePod ? "Same pod as the brand" : "Another pod"}, ${load === 0 ? "no assignments yet" : `${load}% allocated`}, shift fits in ${emp.maxDailyHours} h.`,
        });
      }
      ranked.sort(
        (a, b) =>
          Number(b.samePod) - Number(a.samePod) ||
          a.sortLoad - b.sortLoad ||
          a.name.localeCompare(b.name) ||
          a.employeeId.localeCompare(b.employeeId),
      );
      for (const r of ranked.slice(0, perBrandProcess)) {
        const { sortLoad, ...c } = r;
        void sortLoad;
        candidates.push(c);
      }
    }
    out.push({
      brandProcessId: bp.id,
      brandName: bp.brandName,
      processCode: bp.processCode,
      status,
      primaries,
      backups,
      peakRequired: peak,
      candidates,
    });
  }
  return out;
}
