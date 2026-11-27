import { describe, expect, it } from "vitest";
import { backupReport } from "../backup";
import { seedInput } from "./seedInput";

const input = seedInput("2026-12");
const report = backupReport(input);
const of = (brand: string, code: string) =>
  report.find((r) => r.brandName === brand && r.processCode === code)!;

describe("backup recommendations (P5.1) on the demo seed", () => {
  it("Coastal Candles has a backup (Divya), so it is covered and gets no candidates", () => {
    for (const code of ["CS", "ACC"]) {
      const r = of("Coastal Candles", code);
      expect(r.status).toBe("COVERED_BY_BACKUP");
      expect(r.backups.map((b) => b.name)).toEqual(["Divya Menon"]);
      expect(r.candidates).toEqual([]);
    }
  });

  it("Nimbus Gadgets (one person, no backup) is EXPOSED and recommends pod-mates first, never the primary", () => {
    for (const code of ["CS", "NDR"]) {
      const r = of("Nimbus Gadgets", code);
      expect(r.status).toBe("EXPOSED");
      expect(r.primaries.map((p) => p.name)).toEqual(["Ananya Reddy"]);
      expect(r.backups).toEqual([]);
      expect(r.candidates.length).toBe(3);
      expect(r.candidates.some((c) => c.name === "Ananya Reddy")).toBe(false);
      // Nimbus belongs to the Bravo pod: same-pod candidates are ranked before any other pod
      const podFlags = r.candidates.map((c) => c.samePod);
      expect(podFlags).toEqual([...podFlags].sort((a, b) => Number(b) - Number(a)));
      expect(r.candidates[0].samePod).toBe(true);
      for (const c of r.candidates) {
        expect(c.suggestedPct).toBeGreaterThan(0);
        expect(c.loadPct + c.suggestedPct).toBeLessThanOrEqual(100);
      }
    }
  });

  it("Orbit Electronics (three people, minimum 2) is SHARED: an absence is absorbed, so nothing is recommended", () => {
    const r = of("Orbit Electronics", "CS");
    expect(r.status).toBe("SHARED");
    expect(r.peakRequired).toBeGreaterThanOrEqual(2);
    expect(r.primaries.length).toBe(3);
    expect(r.candidates).toEqual([]);
  });

  it("is deterministic: the same input gives the same report", () => {
    expect(backupReport(seedInput("2026-12"))).toEqual(report);
  });

  it("every brand-process has a report and a status; EXPOSED ones are single-primary-or-fewer than the peak", () => {
    expect(report.length).toBe(input.brandProcesses.length);
    for (const r of report) {
      if (r.status === "EXPOSED") expect(r.primaries.length).toBeLessThanOrEqual(r.peakRequired);
      if (r.status === "SHARED") expect(r.primaries.length).toBeGreaterThan(r.peakRequired);
    }
  });
});

describe("candidate filters", () => {
  it("skips inactive people, people with no spare allocation, and shifts that break their daily hours", () => {
    const base = seedInput("2026-12");
    const nimbus = base.brandProcesses.find(
      (b) => b.brandName === "Nimbus Gadgets" && b.processCode === "CS",
    )!;
    const normal = backupReport(base, 50).find((r) => r.brandProcessId === nimbus.id)!;
    const first = normal.candidates[0];

    // deactivate the best candidate: they disappear
    const inactive = {
      ...base,
      employees: base.employees.map((e) =>
        e.id === first.employeeId ? { ...e, isActive: false } : e,
      ),
    };
    expect(
      backupReport(inactive, 50)
        .find((r) => r.brandProcessId === nimbus.id)!
        .candidates.some((c) => c.employeeId === first.employeeId),
    ).toBe(false);

    // give them a full day elsewhere: no spare allocation, so they disappear
    const bpElse = base.brandProcesses.find((b) => b.id !== nimbus.id)!;
    const full = {
      ...base,
      assignments: [
        ...base.assignments.filter((a) => !(a.employeeId === first.employeeId)),
        {
          employeeId: first.employeeId,
          brandProcessId: bpElse.id,
          role: "PRIMARY" as const,
          allocationPct: 100,
        },
      ],
    };
    expect(
      backupReport(full, 50)
        .find((r) => r.brandProcessId === nimbus.id)!
        .candidates.some((c) => c.employeeId === first.employeeId),
    ).toBe(false);

    // a 1-hour daily maximum cannot fit a 9 hour shift
    const tiny = {
      ...base,
      employees: base.employees.map((e) =>
        e.id === first.employeeId ? { ...e, maxDailyHours: 1 } : e,
      ),
    };
    expect(
      backupReport(tiny, 50)
        .find((r) => r.brandProcessId === nimbus.id)!
        .candidates.some((c) => c.employeeId === first.employeeId),
    ).toBe(false);
  });

  it("ranks a same-pod candidate before another pod's, even when the other pod's person is less loaded", () => {
    const base = seedInput("2026-12");
    const nimbus = base.brandProcesses.find(
      (b) => b.brandName === "Nimbus Gadgets" && b.processCode === "CS",
    )!;
    const normal = backupReport(base, 50).find((r) => r.brandProcessId === nimbus.id)!;
    const samePod = normal.candidates.filter((c) => c.samePod);
    const other = normal.candidates.filter((c) => !c.samePod);
    expect(samePod.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
    // make every same-pod candidate carry more allocation than the least-loaded other-pod candidate
    const least = Math.min(...other.map((c) => c.loadPct));
    const filler = base.brandProcesses.find((b) => b.id !== nimbus.id)!;
    const heavier = {
      ...base,
      assignments: [
        ...base.assignments,
        ...samePod
          .filter((c) => c.loadPct <= least)
          .map((c) => ({
            employeeId: c.employeeId,
            brandProcessId: filler.id,
            role: "BACKUP" as const,
            allocationPct: Math.min(95 - c.loadPct, 100),
          }))
          .filter(
            (a) =>
              a.allocationPct > 0 &&
              !base.assignments.some(
                (x) => x.employeeId === a.employeeId && x.brandProcessId === a.brandProcessId,
              ),
          ),
      ],
    };
    const r = backupReport(heavier, 50).find((x) => x.brandProcessId === nimbus.id)!;
    const firstOther = r.candidates.findIndex((c) => !c.samePod);
    const lastSame = r.candidates.map((c) => c.samePod).lastIndexOf(true);
    expect(lastSame).toBeGreaterThanOrEqual(0);
    expect(lastSame).toBeLessThan(firstOther); // every same-pod candidate comes first
    const lightestOther = r.candidates
      .filter((c) => !c.samePod)
      .reduce((m, c) => Math.min(m, c.loadPct), 100);
    const heaviestSame = Math.max(...r.candidates.filter((c) => c.samePod).map((c) => c.loadPct));
    expect(heaviestSame).toBeGreaterThan(lightestOther); // and that ordering really was a pod decision, not load
  });
});
