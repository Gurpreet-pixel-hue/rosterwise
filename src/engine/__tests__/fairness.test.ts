import { describe, expect, it } from "vitest";
import { applyEdits } from "../edit";
import { fairnessReport } from "../fairness";
import { generateRoster } from "../generate";
import { seedInput } from "./seedInput";

const input = seedInput("2026-12");
const gen = generateRoster(input);
const report = fairnessReport(input, gen.draft);
const row = (name: string) => report.rows.find((r) => r.name === name)!;

describe("fairness report (P5.3) on December 2026", () => {
  it("counts the month's Sundays (not holidays) and public holidays", () => {
    // 6, 13, 20, 27 Dec are Sundays, but 6 Dec is also a public holiday: 3 plain Sundays + 2 holidays (6 and 25)
    expect(report.sundays).toBe(3);
    expect(report.holidays).toBe(2);
  });

  it("is internally consistent for every person", () => {
    for (const r of report.rows) {
      expect(r.sundaysWorked + r.sundaysOff).toBe(report.sundays);
      expect(r.holidaysWorked + r.holidaysOff).toBeLessThanOrEqual(report.holidays);
      expect(r.premiumDaysWorked).toBe(r.sundaysWorked + r.holidaysWorked);
      expect(r.weeklyOffsOnSunday).toBeLessThanOrEqual(r.sundaysOff);
      expect(r.workingDays).toBeLessThanOrEqual(31);
    }
  });

  it("matches the comp-off credits: every holiday worked earns one", () => {
    expect(report.rows.reduce((n, r) => n + r.holidaysWorked, 0)).toBe(
      gen.draft.compOffEarned.length,
    );
  });

  it("only counts people who could be asked to work the day in the spread", () => {
    // Aarav's three brands are closed on Sundays and holidays: structurally 0, so not eligible
    expect(row("Aarav Sharma").sundayEligible).toBe(false);
    expect(row("Aarav Sharma").holidayEligible).toBe(false);
    expect(row("Aarav Sharma").sundaysWorked).toBe(0);
    // Ananya covers ALL_DAYS brands alone: eligible, and works every Sunday and holiday (no backup, Nimbus)
    expect(row("Ananya Reddy")).toMatchObject({
      sundayEligible: true,
      holidayEligible: true,
      sundaysWorked: 3,
      holidaysWorked: 2,
    });
    expect(report.sundaySpread.eligibleCount).toBe(
      report.rows.filter((r) => r.sundayEligible).length,
    );
    expect(report.sundaySpread.eligibleCount).toBeLessThan(report.rows.length);
    expect(report.premiumSpread.max).toBe(5);
    expect(report.premiumSpread.min).toBe(0);
    expect(report.premiumSpread.difference).toBe(5);
    expect(report.sundaySpread.mostEmployeeIds).toContain("emp-ananya-reddy");
  });

  it("rows are sorted by premium days worked, most first, then by name", () => {
    const p = report.rows.map((r) => r.premiumDaysWorked);
    expect(p).toEqual([...p].sort((a, b) => b - a));
  });

  it("moves with the roster: giving someone a Sunday off lowers their count and raises their Sunday-off count", () => {
    // pick the first person who works a plain Sunday (not the 6th, a holiday) in the generated roster
    const sundays = ["2026-12-13", "2026-12-20", "2026-12-27"];
    const e = gen.draft.entries.find((x) => sundays.includes(x.date) && x.status === "WORK")!;
    expect(e).toBeDefined();
    const before = report.rows.find((r) => r.employeeId === e.employeeId)!;
    const edited = applyEdits(
      gen.draft,
      [
        {
          employeeId: e.employeeId,
          date: e.date,
          status: "WEEKLY_OFF",
          coveredBrandProcessIds: [],
        },
      ],
      { locked: true, source: "MANUAL" },
    );
    const after = fairnessReport(input, edited).rows.find((r) => r.employeeId === e.employeeId)!;
    expect(after.sundaysWorked).toBe(before.sundaysWorked - 1);
    expect(after.sundaysOff).toBe(before.sundaysOff + 1);
    expect(after.weeklyOffsOnSunday).toBe(before.weeklyOffsOnSunday + 1);
    expect(after.workingDays).toBe(before.workingDays - 1);
  });

  it("is deterministic", () => {
    expect(fairnessReport(input, gen.draft)).toEqual(report);
  });
});
