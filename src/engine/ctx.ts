// Read-only indexes derived once per engine call. Internal to the engine.
import { buildAvailability, type Availability } from "./availability";
import { isOperating, monthDates, weeksOfMonth, type RosterWeek } from "./calendar";
import { expandDemand, indexOverrides, type DemandContext } from "./demand";
import type {
  EngineAssignment,
  EngineBrandProcess,
  EngineEmployee,
  EngineInput,
  NeighbourRoster,
} from "./types";

export interface Ctx {
  input: EngineInput;
  month: string;
  monthDates: string[];
  monthSet: ReadonlySet<string>;
  /** Every date of every Mon-Sun week touching the month, in order. */
  window: string[];
  weeks: RosterWeek[];
  /** Active employees, sorted by id. */
  employees: EngineEmployee[];
  empById: ReadonlyMap<string, EngineEmployee>;
  bps: EngineBrandProcess[];
  bpById: ReadonlyMap<string, EngineBrandProcess>;
  holidays: ReadonlyMap<string, string>;
  demandCtx: DemandContext;
  /** Map<bpId, Map<date, required>> over the whole window. */
  demand: ReadonlyMap<string, ReadonlyMap<string, number>>;
  assignments: EngineAssignment[];
  byBp: ReadonlyMap<string, EngineAssignment[]>;
  byEmp: ReadonlyMap<string, EngineAssignment[]>;
  pair: ReadonlyMap<string, EngineAssignment>;
  avail: ReadonlyMap<string, ReadonlyMap<string, Availability>>;
  /** Shift as minutes since midnight. */
  shift: ReadonlyMap<string, readonly [number, number]>;
  neighbours: readonly NeighbourRoster[];
}

export const pairKey = (employeeId: string, bpId: string) => `${employeeId}|${bpId}`;

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildCtx(input: EngineInput): Ctx {
  const month = input.month;
  const dates = monthDates(month);
  const weeks = weeksOfMonth(month);
  const window = weeks.flatMap((w) => w.fullWeek);

  const employees = input.employees.filter((e) => e.isActive).sort(byId);
  const bps = [...input.brandProcesses].sort(byId);

  const assignments = [...input.assignments].sort(
    (a, b) =>
      (a.brandProcessId < b.brandProcessId ? -1 : a.brandProcessId > b.brandProcessId ? 1 : 0) ||
      (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0),
  );
  const byBp = new Map<string, EngineAssignment[]>();
  const byEmp = new Map<string, EngineAssignment[]>();
  const pair = new Map<string, EngineAssignment>();
  for (const a of assignments) {
    byBp.set(a.brandProcessId, [...(byBp.get(a.brandProcessId) ?? []), a]);
    byEmp.set(a.employeeId, [...(byEmp.get(a.employeeId) ?? []), a]);
    pair.set(pairKey(a.employeeId, a.brandProcessId), a);
  }

  const demandCtx: DemandContext = {
    holidays: new Set(input.holidays.map((h) => h.date)),
    overrides: indexOverrides(input.coverageOverrides),
  };

  return {
    input,
    month,
    monthDates: dates,
    monthSet: new Set(dates),
    window,
    weeks,
    employees,
    empById: new Map(input.employees.map((e) => [e.id, e])),
    bps,
    bpById: new Map(bps.map((b) => [b.id, b])),
    holidays: new Map(input.holidays.map((h) => [h.date, h.name])),
    demandCtx,
    demand: expandDemand(bps, window, demandCtx),
    assignments,
    byBp,
    byEmp,
    pair,
    avail: buildAvailability(employees, input.leaves, window),
    shift: new Map(bps.map((b) => [b.id, [minutes(b.shiftStart), minutes(b.shiftEnd)] as const])),
    neighbours: input.neighbourRosters ?? [],
  };
}

export const operatesOn = (ctx: Ctx, bp: EngineBrandProcess, date: string) =>
  isOperating(bp, date, ctx.demandCtx.holidays);

export const requiredOn = (ctx: Ctx, bpId: string, date: string): number =>
  ctx.demand.get(bpId)?.get(date) ?? 0;

/** "Brand / CS" */
export const bpLabel = (bp: EngineBrandProcess) => `${bp.brandName} / ${bp.processCode}`;
