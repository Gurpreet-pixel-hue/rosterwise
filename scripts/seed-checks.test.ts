import { describe, expect, it } from "vitest";
import { buildSeedData, type SeedSnapshot } from "../prisma/seed-data";
import { brandStructures, runSeedChecks, singleResourcePct } from "./seed-checks";

const clone = (s: SeedSnapshot): SeedSnapshot => structuredClone(s);
const failing = (s: SeedSnapshot) =>
  runSeedChecks(s)
    .filter((r) => !r.ok)
    .map((r) => r.id);
const idOf = (s: SeedSnapshot, name: string) => s.employees.find((e) => e.name === name)!.id;
const brandId = (s: SeedSnapshot, name: string) => s.brands.find((b) => b.name === name)!.id;

describe("seed data satisfies CLAUDE.md section 5", () => {
  const seed = buildSeedData();

  it("passes every check", () => {
    const failed = runSeedChecks(seed).filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });

  it("has the headline numbers", () => {
    expect(seed.employees.length).toBeGreaterThanOrEqual(32);
    expect(seed.brands).toHaveLength(20);
    expect(singleResourcePct(seed)).toBe(80);
  });

  it("uses unique ids and unique brand-process / assignment pairs", () => {
    const unique = (xs: string[]) => new Set(xs).size === xs.length;
    expect(unique(seed.employees.map((e) => e.id))).toBe(true);
    expect(unique(seed.brands.map((b) => b.id))).toBe(true);
    expect(unique(seed.brandProcesses.map((b) => b.id))).toBe(true);
    expect(unique(seed.brandProcesses.map((b) => `${b.brandId}|${b.processId}`))).toBe(true);
    expect(unique(seed.assignments.map((a) => `${a.employeeId}|${a.brandProcessId}`))).toBe(true);
  });

  it("is deterministic: building twice gives deep-equal data", () => {
    expect(buildSeedData()).toEqual(buildSeedData());
  });
});

describe("the checks actually catch broken data", () => {
  const base = buildSeedData();

  it("fewer than 32 employees fails", () => {
    const s = clone(base);
    s.employees = s.employees.slice(0, 20);
    expect(failing(s)).toContain("employees");
  });

  it("a second PRIMARY on a single-resource brand drops the single-resource %", () => {
    const s = clone(base);
    const bp = s.brandProcesses.find((b) => b.brandId === brandId(s, "Pixel Pets"))!;
    s.assignments.push({
      id: "x",
      employeeId: idOf(s, "Rohan Mehta"),
      brandProcessId: bp.id,
      role: "PRIMARY",
      allocationPct: 10,
    });
    // 15/20 = 75%, below the 78% floor
    expect(singleResourcePct(s)).toBe(75);
    expect(failing(s)).toContain("single-resource-pct");
  });

  it("BACKUP assignments do not make a brand multi-resource", () => {
    const structures = brandStructures(base);
    expect(structures.find((b) => b.brand === "Coastal Candles")?.isSingleResource).toBe(true);
  });

  it("removing the backup breaks scenario 1", () => {
    const s = clone(base);
    const ids = new Set(
      s.brandProcesses.filter((b) => b.brandId === brandId(s, "Coastal Candles")).map((b) => b.id),
    );
    s.assignments = s.assignments.filter(
      (a) => !(a.role === "BACKUP" && ids.has(a.brandProcessId)),
    );
    expect(failing(s)).toContain("scenario-1");
  });

  it("adding a backup to the no-backup brand breaks scenario 2", () => {
    const s = clone(base);
    const bp = s.brandProcesses.find((b) => b.brandId === brandId(s, "Nimbus Gadgets"))!;
    s.assignments.push({
      id: "x",
      employeeId: idOf(s, "Rohan Mehta"),
      brandProcessId: bp.id,
      role: "BACKUP",
      allocationPct: 50,
    });
    expect(failing(s)).toContain("scenario-2");
  });

  it("a second overlapping leave breaks scenario 3 (it must stay absorbable)", () => {
    const s = clone(base);
    s.leaves.push({
      id: "x",
      employeeId: idOf(s, "Pooja Desai"),
      fromDate: "2026-12-17",
      toDate: "2026-12-17",
      type: "PLANNED",
      status: "APPROVED",
      note: null,
    });
    expect(failing(s)).toContain("scenario-3");
  });

  it("giving Aarav's brand a backup breaks scenario 4", () => {
    const s = clone(base);
    const bp = s.brandProcesses.find((b) => b.brandId === brandId(s, "Verdant Tea Co"))!;
    s.assignments.push({
      id: "x",
      employeeId: idOf(s, "Divya Menon"),
      brandProcessId: bp.id,
      role: "BACKUP",
      allocationPct: 50,
    });
    expect(failing(s)).toContain("scenario-4");
  });

  it("dropping the pending leave fails the December check", () => {
    const s = clone(base);
    s.leaves = s.leaves.filter((l) => l.status !== "PENDING");
    expect(failing(s)).toContain("december-leave");
  });

  it("over-allocating a PRIMARY past 100% fails integrity", () => {
    const s = clone(base);
    const a = s.assignments.find(
      (x) => x.role === "PRIMARY" && x.employeeId === idOf(s, "Aarav Sharma"),
    )!;
    a.allocationPct = 90;
    expect(failing(s)).toContain("integrity");
  });

  it("an inverted shift fails integrity", () => {
    const s = clone(base);
    s.brandProcesses[0].shiftStart = "18:00";
    s.brandProcesses[0].shiftEnd = "09:00";
    expect(failing(s)).toContain("integrity");
  });
});

describe("static feasibility (review finding 2)", () => {
  const base = buildSeedData();
  const brandId = (s: SeedSnapshot, name: string) => s.brands.find((b) => b.name === name)!.id;
  const idOf = (s: SeedSnapshot, name: string) => s.employees.find((e) => e.name === name)!.id;
  const detailOf = (s: SeedSnapshot, id: string) =>
    runSeedChecks(s).find((r) => r.id === id)!.detail;

  it("Helix Sports Nutrition CS has a backup, so Neha's leave on Monday 2027-01-25 is coverable", () => {
    const helixCs = base.brandProcesses.find(
      (b) => b.brandId === brandId(base, "Helix Sports Nutrition") && b.processId === "proc-cs",
    )!;
    expect(
      base.assignments.some((a) => a.brandProcessId === helixCs.id && a.role === "BACKUP"),
    ).toBe(true);
  });

  it("removing the Helix backup fails the capacity check and names 2027-01-25", () => {
    const s = structuredClone(base);
    const helixCs = s.brandProcesses.find(
      (b) => b.brandId === brandId(s, "Helix Sports Nutrition") && b.processId === "proc-cs",
    )!;
    s.assignments = s.assignments.filter(
      (a) => !(a.brandProcessId === helixCs.id && a.role === "BACKUP"),
    );
    const failed = runSeedChecks(s).filter((r) => !r.ok);
    expect(failed.map((r) => r.id)).toContain("static-capacity");
    expect(detailOf(s, "static-capacity")).toContain("Helix Sports Nutrition / CS");
    expect(detailOf(s, "static-capacity")).toContain("2027-01-25 has at most 1 of 2");
  });

  it("an unexpected blocked weekly off fails: removing Urban Brew's only backup (ALL_DAYS CS)", () => {
    const s = structuredClone(base);
    const ids = new Set(
      s.brandProcesses
        .filter((b) => b.brandId === brandId(s, "Urban Brew Coffee"))
        .map((b) => b.id),
    );
    s.assignments = s.assignments.filter(
      (a) => !(a.role === "BACKUP" && ids.has(a.brandProcessId)),
    );
    expect(runSeedChecks(s).find((r) => r.id === "static-weekly-off")!.ok).toBe(false);
    expect(detailOf(s, "static-weekly-off")).toContain("Harleen Kaur");
    expect(detailOf(s, "static-weekly-off")).toContain("UNEXPECTED");
  });

  it("Nimbus Gadgets is reported as EXPECTED, not as a failure", () => {
    const results = runSeedChecks(base);
    expect(results.find((r) => r.id === "static-weekly-off")!.ok).toBe(true);
    expect(detailOf(base, "static-weekly-off")).toContain("EXPECTED: Nimbus Gadgets");
    expect(detailOf(base, "static-weekly-off")).toContain("Ananya Reddy");
    expect(results.find((r) => r.id === "expected-infeasible")!.ok).toBe(true);
  });

  it("giving Nimbus a backup makes the expected infeasibility vanish, which fails", () => {
    const s = structuredClone(base);
    for (const bp of s.brandProcesses.filter((b) => b.brandId === brandId(s, "Nimbus Gadgets"))) {
      s.assignments.push({
        id: `x-${bp.id}`,
        employeeId: idOf(s, "Rohan Mehta"),
        brandProcessId: bp.id,
        role: "BACKUP",
        allocationPct: 50,
      });
    }
    expect(runSeedChecks(s).find((r) => r.id === "expected-infeasible")!.ok).toBe(false);
  });

  it("a leave only blocks when approved: the PENDING and REJECTED leaves do not shrink capacity", () => {
    const s = structuredClone(base);
    for (const l of s.leaves.filter((x) => x.status !== "APPROVED")) l.status = "APPROVED";
    // Approving Aarav's pending leave removes his only coverage of three brands
    expect(runSeedChecks(s).find((r) => r.id === "static-capacity")!.ok).toBe(false);
    expect(runSeedChecks(base).find((r) => r.id === "static-capacity")!.ok).toBe(true);
  });

  it("the December boundary week (28 Dec - 3 Jan) is satisfiable for Sunday-off staff via Sunday 3 Jan", () => {
    // Aarav's three brands are closed on Sundays, so the only free day of that week is Sun 3 Jan,
    // which is a January date. The check must allow it, so no UNEXPECTED weekly-off item appears.
    expect(detailOf(base, "static-weekly-off")).not.toContain("Aarav Sharma");
    expect(detailOf(base, "static-weekly-off")).not.toContain("UNEXPECTED");
  });
});

describe("review findings 5 and 6: scenario 4 mixes backup and no-backup brands", () => {
  const base = buildSeedData();
  const brandId = (s: SeedSnapshot, name: string) => s.brands.find((b) => b.name === name)!.id;
  const bpsOf = (s: SeedSnapshot, name: string) =>
    s.brandProcesses.filter((b) => b.brandId === brandId(s, name)).map((b) => b.id);

  it("Atlas Footwear has a backup; Lumen Skincare and Verdant Tea Co have none", () => {
    const backups = (name: string) =>
      base.assignments.filter(
        (a) => a.role === "BACKUP" && bpsOf(base, name).includes(a.brandProcessId),
      );
    expect(backups("Atlas Footwear").length).toBeGreaterThan(0);
    expect(backups("Lumen Skincare")).toHaveLength(0);
    expect(backups("Verdant Tea Co")).toHaveLength(0);
  });

  it("scenario 4 still passes with the mixed resolution", () => {
    expect(runSeedChecks(base).find((r) => r.id === "scenario-4")!.ok).toBe(true);
  });

  it("scenario 4 fails if a second brand gains a backup (it would leave only one gap)", () => {
    const s = structuredClone(base);
    s.assignments.push({
      id: "x",
      employeeId: s.employees.find((e) => e.name === "Divya Menon")!.id,
      brandProcessId: bpsOf(s, "Verdant Tea Co")[0],
      role: "BACKUP",
      allocationPct: 25,
    });
    expect(runSeedChecks(s).find((r) => r.id === "scenario-4")!.ok).toBe(false);
  });
});
