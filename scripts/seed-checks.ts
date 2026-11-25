// Assertions for every bullet of CLAUDE.md section 5, written against plain rows so they run both
// against the live database (scripts/verify-seed.ts) and against buildSeedData() in CI (no DB).
//
// Calendar and demand logic is NOT reimplemented here: the feasibility checks import the engine's own
// calendar.ts and demand.ts (through scripts/seed-capacity.ts).
import { DEMO_SCENARIOS, type SeedSnapshot } from "../prisma/seed-data";
import { datesBetween, weekdayOf } from "../src/engine/calendar";
import { EXPECTED_INFEASIBLE, findInfeasibilities } from "./seed-capacity";

export interface CheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface BrandStructure {
  brandId: string;
  brand: string;
  primaryEmployeeIds: string[];
  isSingleResource: boolean;
}

const MIN_EMPLOYEES = 32;
const SINGLE_MIN_PCT = 78;
const SINGLE_MAX_PCT = 85;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Single-resource brand = a brand whose PRIMARY assignments across ALL its brand-processes involve
 * exactly one distinct employee. BACKUP assignments do not count.
 */
export const SINGLE_RESOURCE_FORMULA =
  "single-resource brand = exactly 1 distinct PRIMARY employee across all of the brand's processes " +
  "(BACKUPs not counted); % = single-resource brands / all brands";

export function brandStructures(s: SeedSnapshot): BrandStructure[] {
  const bpToBrand = new Map(s.brandProcesses.map((bp) => [bp.id, bp.brandId]));
  const primaries = new Map<string, Set<string>>(s.brands.map((b) => [b.id, new Set<string>()]));
  for (const a of s.assignments) {
    if (a.role !== "PRIMARY") continue;
    const brand = bpToBrand.get(a.brandProcessId);
    if (brand) primaries.get(brand)?.add(a.employeeId);
  }
  return s.brands.map((b) => {
    const ids = [...(primaries.get(b.id) ?? [])].sort();
    return {
      brandId: b.id,
      brand: b.name,
      primaryEmployeeIds: ids,
      isSingleResource: ids.length === 1,
    };
  });
}

export function singleResourcePct(s: SeedSnapshot): number {
  const all = brandStructures(s);
  return all.length === 0 ? 0 : (all.filter((b) => b.isSingleResource).length / all.length) * 100;
}

function ok(id: string, label: string, pass: boolean, detail: string): CheckResult {
  return { id, label, ok: pass, detail };
}

export function runSeedChecks(s: SeedSnapshot): CheckResult[] {
  const r: CheckResult[] = [];
  const empById = new Map(s.employees.map((e) => [e.id, e]));
  const brandById = new Map(s.brands.map((b) => [b.id, b]));
  const bpById = new Map(s.brandProcesses.map((bp) => [bp.id, bp]));
  const procById = new Map(s.processes.map((p) => [p.id, p]));
  const structures = brandStructures(s);
  const nameOf = (id: string) => empById.get(id)?.name ?? id;

  // ---- Staffing shape ------------------------------------------------------------------------
  r.push(
    ok(
      "employees",
      `>= ${MIN_EMPLOYEES} employees`,
      s.employees.length >= MIN_EMPLOYEES,
      `${s.employees.length} employees`,
    ),
  );

  const leadsOk =
    s.pods.length === 4 &&
    s.pods.every((p) => {
      const lead = empById.get(p.leadId);
      return lead !== undefined && lead.podId === p.id;
    });
  r.push(
    ok(
      "pods",
      "4 pods, each with a lead who is an employee of that pod",
      leadsOk,
      s.pods.map((p) => `${p.name}: ${nameOf(p.leadId)}`).join("; "),
    ),
  );

  r.push(
    ok(
      "brands",
      "about 20 brands (18 to 22)",
      s.brands.length >= 18 && s.brands.length <= 22,
      `${s.brands.length} brands`,
    ),
  );

  const singles = structures.filter((b) => b.isSingleResource);
  const pct = singleResourcePct(s);
  r.push(
    ok(
      "single-resource-pct",
      `${SINGLE_MIN_PCT}% to ${SINGLE_MAX_PCT}% of brands are single-resource`,
      pct >= SINGLE_MIN_PCT && pct <= SINGLE_MAX_PCT,
      `${singles.length}/${structures.length} = ${pct.toFixed(1)}%`,
    ),
  );

  const multis = structures.filter((b) => !b.isSingleResource);
  r.push(
    ok(
      "multi-resource-size",
      "every other brand has 2 or 3 distinct PRIMARY employees",
      multis.every((b) => b.primaryEmployeeIds.length >= 2 && b.primaryEmployeeIds.length <= 3),
      multis.map((b) => `${b.brand}: ${b.primaryEmployeeIds.length}`).join("; "),
    ),
  );

  // Per brand: map employee -> set of BPs they are PRIMARY on.
  const primaryBpsByBrand = new Map<string, Map<string, Set<string>>>();
  const primaryEmpsByBp = new Map<string, Set<string>>();
  for (const a of s.assignments) {
    if (a.role !== "PRIMARY") continue;
    const bp = bpById.get(a.brandProcessId);
    if (!bp) continue;
    const perBrand = primaryBpsByBrand.get(bp.brandId) ?? new Map<string, Set<string>>();
    const set = perBrand.get(a.employeeId) ?? new Set<string>();
    set.add(bp.id);
    perBrand.set(a.employeeId, set);
    primaryBpsByBrand.set(bp.brandId, perBrand);
    const emps = primaryEmpsByBp.get(bp.id) ?? new Set<string>();
    emps.add(a.employeeId);
    primaryEmpsByBp.set(bp.id, emps);
  }

  const separateProcessBrands = multis.filter((b) => {
    const per = primaryBpsByBrand.get(b.brandId);
    if (!per) return false;
    const sets = [...per.values()];
    // at least two employees whose process sets are disjoint
    return sets.some((x, i) => sets.some((y, j) => i < j && [...x].every((bp) => !y.has(bp))));
  });
  r.push(
    ok(
      "separate-processes",
      "at least one brand has separate processes per person",
      separateProcessBrands.length >= 1,
      separateProcessBrands.map((b) => b.brand).join("; ") || "none",
    ),
  );

  const sharedBps = [...primaryEmpsByBp.entries()].filter(([, e]) => e.size >= 2);
  r.push(
    ok(
      "shared-process",
      "at least one brand where 2 or more people share a process",
      sharedBps.length >= 1,
      sharedBps
        .map(([bpid]) => {
          const bp = bpById.get(bpid)!;
          return `${brandById.get(bp.brandId)?.name} / ${procById.get(bp.processId)?.code}`;
        })
        .join("; ") || "none",
    ),
  );

  // ---- Processes and rules -------------------------------------------------------------------
  const codes = s.processes.map((p) => p.code);
  const required = ["CS", "ACC", "NDR", "RET"];
  r.push(
    ok(
      "processes",
      "processes CS, ACC, NDR, RET plus a brand-specific one",
      required.every((c) => codes.includes(c)) && codes.some((c) => !required.includes(c)),
      codes.join(", "),
    ),
  );

  const rulesUsed = new Set(s.brandProcesses.map((bp) => bp.operatingRule));
  r.push(
    ok(
      "operating-rules",
      "all four operating rules are used",
      ["ALL_DAYS", "NO_PUBLIC_HOLIDAYS", "NO_SUNDAY_NO_PH", "CUSTOM"].every((x) =>
        rulesUsed.has(x as never),
      ),
      [...rulesUsed].sort().join(", "),
    ),
  );

  const mixedBrands = s.brands.filter((b) => {
    const bps = s.brandProcesses.filter((bp) => bp.brandId === b.id);
    const cs = bps.find((bp) => procById.get(bp.processId)?.code === "CS");
    return (
      cs?.operatingRule === "ALL_DAYS" &&
      bps.some((bp) => bp !== cs && bp.operatingRule === "NO_SUNDAY_NO_PH")
    );
  });
  r.push(
    ok(
      "mixed-calendar-brand",
      "a brand whose CS is ALL_DAYS while its other process is NO_SUNDAY_NO_PH",
      mixedBrands.length >= 1,
      mixedBrands.map((b) => b.name).join("; ") || "none",
    ),
  );

  const weekdayMins = s.brandProcesses.filter(
    (bp) => bp.weekdayMinStaff && Object.keys(bp.weekdayMinStaff).length > 0,
  );
  r.push(
    ok(
      "weekday-min-staff",
      "at least one weekdayMinStaff",
      weekdayMins.length >= 1,
      weekdayMins
        .map((bp) => `${brandById.get(bp.brandId)?.name}: ${JSON.stringify(bp.weekdayMinStaff)}`)
        .join("; ") || "none",
    ),
  );
  r.push(
    ok(
      "coverage-override",
      "at least one CoverageOverride",
      s.coverageOverrides.length >= 1,
      s.coverageOverrides
        .map((o) => {
          const bp = bpById.get(o.brandProcessId);
          return `${brandById.get(bp?.brandId ?? "")?.name} ${o.date} min ${o.minStaff}`;
        })
        .join("; ") || "none",
    ),
  );

  // ---- People patterns -----------------------------------------------------------------------
  const soleOf = new Map<string, string[]>(); // employee -> single-resource brand names
  for (const b of singles) {
    const emp = b.primaryEmployeeIds[0];
    soleOf.set(emp, [...(soleOf.get(emp) ?? []), b.brand]);
  }
  const multiBrandStaff = [...soleOf.entries()].filter(([, brands]) => brands.length >= 2);
  r.push(
    ok(
      "multi-brand-staff",
      "some employees cover 2 to 3 single-resource brands",
      multiBrandStaff.length >= 1 && multiBrandStaff.every(([, brands]) => brands.length <= 3),
      multiBrandStaff.map(([e, brands]) => `${nameOf(e)} (${brands.length})`).join("; ") || "none",
    ),
  );

  const prefSets = new Set(s.employees.map((e) => [...e.preferredOffDays].sort().join("+")));
  prefSets.delete("");
  const fixed = s.employees.filter((e) => e.fixedOffDays.length > 0);
  r.push(
    ok(
      "off-day-patterns",
      "varied preferredOffDays (3+ distinct) and at least one fixedOffDays",
      prefSets.size >= 3 && fixed.length >= 1,
      `${prefSets.size} distinct preferences; fixed off: ${
        fixed.map((e) => `${e.name} ${e.fixedOffDays.join("/")}`).join("; ") || "none"
      }`,
    ),
  );

  // ---- Calendar and leave --------------------------------------------------------------------
  const holidayDates = new Set(s.holidays.map((h) => h.date));
  const wantedPh = ["2026-12-25", "2027-01-01", "2027-01-26"];
  r.push(
    ok(
      "public-holidays",
      "public holidays include 25 Dec 2026, 1 Jan 2027, 26 Jan 2027",
      wantedPh.every((d) => holidayDates.has(d)),
      s.holidays.map((h) => `${h.date} ${h.name}`).join("; "),
    ),
  );
  const sundayPh = s.holidays.filter((h) => weekdayOf(h.date) === "SUN");
  r.push(
    ok(
      "sunday-holiday",
      "a public holiday falls on a Sunday (edge case for the engine)",
      sundayPh.length >= 1,
      sundayPh.map((h) => `${h.date} ${h.name}`).join("; ") || "none",
    ),
  );

  const inDec = (l: { fromDate: string; toDate: string }) =>
    l.fromDate <= "2026-12-31" && l.toDate >= "2026-12-01";
  const decPlanned = s.leaves.filter(
    (l) => inDec(l) && l.status === "APPROVED" && l.type !== "COMP_OFF",
  );
  const decCompOff = s.leaves.filter(
    (l) => inDec(l) && l.status === "APPROVED" && l.type === "COMP_OFF",
  );
  const pending = s.leaves.filter((l) => l.status === "PENDING");
  r.push(
    ok(
      "december-leave",
      "December has approved leave, an approved comp-off, and there is a PENDING leave",
      decPlanned.length >= 1 && decCompOff.length >= 1 && pending.length >= 1,
      `${decPlanned.length} approved leaves, ${decCompOff.length} approved comp-off, ${pending.length} pending`,
    ),
  );
  r.push(
    ok(
      "month-spanning-leave",
      "a leave spans the Dec/Jan month boundary (edge case for the engine)",
      s.leaves.some((l) => l.fromDate <= "2026-12-31" && l.toDate >= "2027-01-01"),
      "leave crossing 31 Dec / 1 Jan",
    ),
  );
  const usedCredits = s.compOffCredits.filter((c) => c.usedOn !== null);
  r.push(
    ok(
      "comp-off-credit",
      "each approved COMP_OFF leave has a matching used credit",
      decCompOff.every((l) =>
        s.compOffCredits.some((c) => c.employeeId === l.employeeId && c.usedOn === l.fromDate),
      ) && usedCredits.length >= 1,
      `${usedCredits.length} used credit(s), ${s.compOffCredits.length - usedCredits.length} unused`,
    ),
  );

  // ---- Referential and range integrity -------------------------------------------------------
  const problems: string[] = [];
  for (const a of s.assignments) {
    if (!empById.has(a.employeeId)) problems.push(`assignment ${a.id}: unknown employee`);
    if (!bpById.has(a.brandProcessId)) problems.push(`assignment ${a.id}: unknown brand-process`);
    if (a.allocationPct < 1 || a.allocationPct > 100)
      problems.push(`assignment ${a.id}: allocation ${a.allocationPct}`);
  }
  const pairs = new Set<string>();
  for (const a of s.assignments) {
    const k = `${a.employeeId}|${a.brandProcessId}`;
    if (pairs.has(k)) problems.push(`duplicate assignment ${k}`);
    pairs.add(k);
  }
  for (const bp of s.brandProcesses) {
    if (!brandById.has(bp.brandId)) problems.push(`${bp.id}: unknown brand`);
    if (!procById.has(bp.processId)) problems.push(`${bp.id}: unknown process`);
    if (!TIME_RE.test(bp.shiftStart) || !TIME_RE.test(bp.shiftEnd) || bp.shiftStart >= bp.shiftEnd)
      problems.push(`${bp.id}: bad shift ${bp.shiftStart}-${bp.shiftEnd}`);
    if (!primaryEmpsByBp.has(bp.id)) problems.push(`${bp.id}: no PRIMARY employee`);
    if (bp.operatingRule === "CUSTOM" && bp.customWeekdays.length === 0)
      problems.push(`${bp.id}: CUSTOM rule without customWeekdays`);
  }
  const loadByEmp = new Map<string, number>();
  for (const a of s.assignments) {
    if (a.role === "PRIMARY")
      loadByEmp.set(a.employeeId, (loadByEmp.get(a.employeeId) ?? 0) + a.allocationPct);
  }
  for (const [e, load] of loadByEmp) {
    if (load > 100) problems.push(`${nameOf(e)}: PRIMARY allocation ${load}% > 100%`);
  }
  for (const l of s.leaves) {
    if (!empById.has(l.employeeId)) problems.push(`leave ${l.id}: unknown employee`);
    if (!DATE_RE.test(l.fromDate) || !DATE_RE.test(l.toDate) || l.fromDate > l.toDate)
      problems.push(`leave ${l.id}: bad range ${l.fromDate}..${l.toDate}`);
  }
  for (const h of s.holidays) if (!DATE_RE.test(h.date)) problems.push(`holiday ${h.id}: bad date`);
  for (const o of s.coverageOverrides) {
    if (!bpById.has(o.brandProcessId)) problems.push(`override ${o.id}: unknown brand-process`);
    if (!DATE_RE.test(o.date) || o.minStaff < 0) problems.push(`override ${o.id}: bad value`);
  }
  for (const c of s.compOffCredits) {
    if (!empById.has(c.employeeId)) problems.push(`credit ${c.id}: unknown employee`);
  }
  r.push(
    ok(
      "integrity",
      "references, ranges, shifts and PRIMARY allocation (<= 100%) are consistent",
      problems.length === 0,
      problems.length === 0 ? "no problems" : problems.slice(0, 5).join("; "),
    ),
  );

  // ---- Static feasibility (necessary conditions only) ----------------------------------------
  r.push(...checkFeasibility(s));

  // ---- Deliberate demo scenarios -------------------------------------------------------------
  r.push(...checkScenarios(s));
  return r;
}

function checkScenarios(s: SeedSnapshot): CheckResult[] {
  const out: CheckResult[] = [];
  const brandByName = new Map(s.brands.map((b) => [b.name, b]));
  const empByName = new Map(s.employees.map((e) => [e.name, e]));
  const procById = new Map(s.processes.map((p) => [p.id, p]));
  const structures = new Map(brandStructures(s).map((b) => [b.brand, b]));
  const bpsOf = (brandName: string) =>
    s.brandProcesses.filter((bp) => bp.brandId === brandByName.get(brandName)?.id);
  const backupsOn = (bpid: string) =>
    s.assignments.filter((a) => a.brandProcessId === bpid && a.role === "BACKUP");

  // 1. single-resource ALL_DAYS brand WITH a backup on every ALL_DAYS process
  {
    const sc = DEMO_SCENARIOS.singleWithBackup;
    const bps = bpsOf(sc.brand);
    const allDays = bps.filter((bp) => bp.operatingRule === "ALL_DAYS");
    const pass =
      structures.get(sc.brand)?.isSingleResource === true &&
      allDays.length >= 1 &&
      allDays.every((bp) =>
        backupsOn(bp.id).some((a) => a.employeeId === empByName.get(sc.backup)?.id),
      );
    out.push(
      ok(
        "scenario-1",
        "Scenario 1: single-resource ALL_DAYS brand with a backup",
        pass,
        `${sc.brand}: ${sc.primary} backed up by ${sc.backup}`,
      ),
    );
  }

  // 2. single-resource ALL_DAYS brand with NO backup anywhere
  {
    const sc = DEMO_SCENARIOS.singleNoBackup;
    const bps = bpsOf(sc.brand);
    const pass =
      structures.get(sc.brand)?.isSingleResource === true &&
      bps.some((bp) => bp.operatingRule === "ALL_DAYS") &&
      bps.every((bp) => backupsOn(bp.id).length === 0);
    out.push(
      ok(
        "scenario-2",
        "Scenario 2: single-resource ALL_DAYS brand without a backup",
        pass,
        `${sc.brand}: ${sc.primary}, no BACKUP assignments`,
      ),
    );
  }

  // 3. three people share one process (min >= 2), no backup, one absorbable leave in December
  {
    const sc = DEMO_SCENARIOS.threePersonBrand;
    const bp = bpsOf(sc.brand).find((x) => procById.get(x.processId)?.code === sc.process);
    const primaryIds = new Set(
      s.assignments
        .filter((a) => a.brandProcessId === bp?.id && a.role === "PRIMARY")
        .map((a) => a.employeeId),
    );
    const personIds = sc.people.map((n) => empByName.get(n)?.id);
    const leaves = s.leaves.filter(
      (l) =>
        primaryIds.has(l.employeeId) &&
        l.status === "APPROVED" &&
        l.fromDate <= "2026-12-31" &&
        l.toDate >= "2026-12-01",
    );
    const overlapping = leaves.some((a) =>
      leaves.some((b) => a !== b && a.fromDate <= b.toDate && b.fromDate <= a.toDate),
    );
    const pass =
      bp !== undefined &&
      primaryIds.size === 3 &&
      personIds.every((id) => id !== undefined && primaryIds.has(id)) &&
      bp.defaultMinStaff >= 2 &&
      backupsOn(bp.id).length === 0 &&
      leaves.length >= 1 &&
      !overlapping;
    out.push(
      ok(
        "scenario-3",
        "Scenario 3: 3-person shared process (min 2): one leave absorbable, no overlapping second",
        pass,
        `${sc.brand} / ${sc.process}: ${sc.people.join(", ")}; seeded leave: ${sc.absorbedLeave}`,
      ),
    );
  }

  // 4. multi-brand employee, sole PRIMARY of 3 brands, with a PENDING leave on a day all of them
  //    operate. Mixed resolution: exactly one brand has a backup (auto-covered), two have none.
  {
    const sc = DEMO_SCENARIOS.cascade;
    const emp = empByName.get(sc.employee);
    const backupIdsOf = (bn: string) =>
      new Set(bpsOf(bn).flatMap((bp) => backupsOn(bp.id).map((a) => a.employeeId)));
    const soleOwner = sc.brands.every((bn) => {
      const st = structures.get(bn);
      return st?.isSingleResource === true && st.primaryEmployeeIds[0] === emp?.id;
    });
    const backedUpOk =
      backupIdsOf(sc.backedUpBrand).size === 1 &&
      backupIdsOf(sc.backedUpBrand).has(empByName.get(sc.backup)?.id ?? "");
    const unbackedOk = sc.unbackedBrands.every((bn) => backupIdsOf(bn).size === 0);
    const pending = s.leaves.find((l) => l.employeeId === emp?.id && l.status === "PENDING");
    const hasWeekday =
      pending !== undefined &&
      datesBetween(pending.fromDate, pending.toDate).some((d) => {
        const wd = weekdayOf(d);
        return wd !== "SAT" && wd !== "SUN" && !s.holidays.some((h) => h.date === d);
      });
    out.push(
      ok(
        "scenario-4",
        "Scenario 4: multi-brand employee, pending leave; 1 brand has a backup, 2 do not",
        soleOwner && backedUpOk && unbackedOk && hasWeekday,
        `${sc.employee} -> ${sc.brands.join(", ")}; ${sc.backedUpBrand} backed up by ${sc.backup}; ` +
          `pending ${pending?.fromDate}..${pending?.toDate}`,
      ),
    );
  }
  return out;
}

const FEASIBILITY_NOTE = "necessary condition only, not proof a roster exists";

function checkFeasibility(s: SeedSnapshot): CheckResult[] {
  const all = findInfeasibilities(s);
  const expected = (i: { brand: string }) => EXPECTED_INFEASIBLE.includes(i.brand);
  const describe = (items: typeof all) => items.map((i) => i.message).join(" | ");
  const section = (kind: "CAPACITY" | "WEEKLY_OFF") => {
    const items = all.filter((i) => i.kind === kind);
    const unexpected = items.filter((i) => !expected(i));
    const exp = items.filter(expected);
    return { unexpected, exp };
  };

  const cap = section("CAPACITY");
  const off = section("WEEKLY_OFF");
  const found = new Set(all.filter(expected).map((i) => i.brand));
  const missing = EXPECTED_INFEASIBLE.filter((b) => !found.has(b));

  const detail = (x: ReturnType<typeof section>, clean: string) =>
    [
      x.unexpected.length === 0 ? clean : `UNEXPECTED: ${describe(x.unexpected)}`,
      x.exp.length > 0
        ? `EXPECTED: ${x.exp.map((i) => `${i.brand}: ${i.message}`).join(" | ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" || ");

  return [
    ok(
      "static-capacity",
      `static capacity (Dec 2026 and Jan 2027): every operating day has enough available staff (${FEASIBILITY_NOTE}; ignores weekly offs)`,
      cap.unexpected.length === 0,
      detail(cap, "no unexpected shortfall"),
    ),
    ok(
      "static-weekly-off",
      `static weekly-off slack: everyone with PRIMARY duties has a day they are not needed (${FEASIBILITY_NOTE})`,
      off.unexpected.length === 0,
      detail(off, "no unexpected blocked weekly off"),
    ),
    ok(
      "expected-infeasible",
      "every deliberately unschedulable brand (EXPECTED_INFEASIBLE) really is infeasible",
      missing.length === 0,
      missing.length === 0
        ? `EXPECTED: ${[...found].join(", ")}`
        : `no longer infeasible: ${missing.join(", ")}`,
    ),
  ];
}
