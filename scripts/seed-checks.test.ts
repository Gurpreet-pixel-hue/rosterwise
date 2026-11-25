import { describe, expect, it } from "vitest";
import { buildSeedData, type SeedSnapshot } from "../prisma/seed-data";
import {
  brandStructures,
  datesBetween,
  runSeedChecks,
  singleResourcePct,
  weekdayOf,
} from "./seed-checks";

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

describe("date helpers are timezone-proof", () => {
  it("weekdayOf", () => {
    expect(weekdayOf("2026-12-01")).toBe("TUE");
    expect(weekdayOf("2026-12-06")).toBe("SUN");
    expect(weekdayOf("2027-01-26")).toBe("TUE");
  });

  it("datesBetween crosses a month and year boundary inclusively", () => {
    expect(datesBetween("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
});
