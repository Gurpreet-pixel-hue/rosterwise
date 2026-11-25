import { describe, expect, it } from "vitest";
import { applyEdits } from "../edit";
import { generateRoster } from "../generate";
import { validateRoster } from "../validate";
import {
  backup,
  bp,
  emp,
  entry,
  errors,
  issuesOf,
  leave,
  makeInput,
  offDates,
  primary,
} from "./fixtures";

const manual = (
  employeeId: string,
  date: string,
  status: "WORK" | "WEEKLY_OFF",
  covered: string[] = [],
) => ({
  employeeId,
  date,
  status,
  coveredBrandProcessIds: covered,
});

describe("every issue code is detected, with the right severity", () => {
  it("NO_ELIGIBLE_STAFF: a brand-process that operates but has nobody assigned (one issue, not a flood of gaps)", () => {
    const input = makeInput({ employees: [emp("A")], brandProcesses: [bp("X")], assignments: [] });
    const { issues } = generateRoster(input);
    const none = issuesOf(issues, "NO_ELIGIBLE_STAFF");
    expect(none).toHaveLength(1);
    expect(none[0].severity).toBe("ERROR");
    expect(none[0].brandProcessId).toBe("X");
    expect(issuesOf(issues, "COVERAGE_GAP")).toEqual([]);
  });

  it("WORK_WHILE_UNAVAILABLE: only possible through a manual edit on a day of approved leave", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
      leaves: [leave("A", "2026-12-09", "2026-12-09")],
    });
    const { draft, issues } = generateRoster(input);
    expect(issuesOf(issues, "WORK_WHILE_UNAVAILABLE")).toEqual([]); // the generator never does this
    expect(entry(draft, "A", "2026-12-09").status).toBe("LEAVE");

    const edited = applyEdits(draft, [manual("A", "2026-12-09", "WORK", ["X"])], {
      locked: true,
      source: "MANUAL",
    });
    const found = issuesOf(validateRoster(input, edited), "WORK_WHILE_UNAVAILABLE");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "ERROR", employeeId: "A", date: "2026-12-09" });
  });

  it("FIXED_OFF_VIOLATED: a contract-fixed off day is forced by the generator, even on a public holiday", () => {
    const input = makeInput({
      employees: [emp("A", { fixedOffDays: ["SUN"] }), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
      holidays: [{ date: "2026-12-06", name: "Sunday PH" }],
    });
    const { draft, issues } = generateRoster(input);
    expect(issuesOf(issues, "FIXED_OFF_VIOLATED")).toEqual([]);
    for (const sunday of ["2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27"]) {
      expect(entry(draft, "A", sunday).status).toBe("WEEKLY_OFF"); // fixed off beats the PH
    }
    expect(errors(issues)).toEqual([]);

    const edited = applyEdits(draft, [manual("A", "2026-12-13", "WORK", ["X"])], {
      locked: true,
      source: "MANUAL",
    });
    const found = issuesOf(validateRoster(input, edited), "FIXED_OFF_VIOLATED");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "ERROR", date: "2026-12-13" });
  });

  it("OVERALLOCATED (warning): two processes of the same brand add up to more than 100%", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B")],
      brandProcesses: [bp("X1", { brandId: "same" }), bp("X2", { brandId: "same" })],
      assignments: [
        primary("A", "X1", 70),
        primary("A", "X2", 60),
        backup("B", "X1", 70),
        backup("B", "X2", 60),
      ],
    });
    const { issues } = generateRoster(input);
    const over = issuesOf(issues, "OVERALLOCATED");
    expect(over.length).toBeGreaterThan(0);
    expect(over.every((i) => i.severity === "WARNING" && i.message.includes("130%"))).toBe(true);
    expect(issuesOf(issues, "SHIFT_INCOMPATIBLE")).toEqual([]);
  });

  it("SHIFT_INCOMPATIBLE: overlapping shifts for DIFFERENT brands that exceed 100% allocation", () => {
    const input = makeInput({
      employees: [emp("A")],
      brandProcesses: [bp("X1"), bp("X2")], // same 09:00-18:00 window, different brands
      assignments: [primary("A", "X1", 70), primary("A", "X2", 60)],
    });
    const { issues } = generateRoster(input);
    const bad = issuesOf(issues, "SHIFT_INCOMPATIBLE");
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0].message).toContain("overlapping shifts");
    expect(issuesOf(issues, "OVERALLOCATED")).toEqual([]); // reported once, as the stronger issue
  });

  it("CONSECUTIVE_DAYS_EXCEEDED (warning): reported once per run, on the day the limit is passed", () => {
    const input = makeInput({
      employees: [emp("A", { weeklyOffsPerWeek: 0 })],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X")],
    });
    const { issues } = generateRoster(input);
    const run = issuesOf(issues, "CONSECUTIVE_DAYS_EXCEEDED");
    expect(run).toHaveLength(1);
    expect(run[0]).toMatchObject({ severity: "WARNING", date: "2026-12-06" }); // 7th day of the window
  });

  it("PENDING_LEAVE_CONFLICT (warning): pending leave on a day the employee is the sole cover, and it is NOT applied", () => {
    const solo = makeInput({
      employees: [emp("A")],
      brandProcesses: [bp("X", { operatingRule: "NO_SUNDAY_NO_PH" })],
      assignments: [primary("A", "X")],
      leaves: [leave("A", "2026-12-09", "2026-12-09", { status: "PENDING" })],
    });
    const r = generateRoster(solo);
    expect(entry(r.draft, "A", "2026-12-09").status).toBe("WORK"); // pending leave is not applied
    const conflict = issuesOf(r.issues, "PENDING_LEAVE_CONFLICT");
    expect(conflict).toHaveLength(1);
    expect(conflict[0]).toMatchObject({ severity: "WARNING", employeeId: "A", date: "2026-12-09" });

    // with a free backup the same pending leave is harmless
    const covered = makeInput({
      ...solo,
      employees: [emp("A"), emp("B")],
      assignments: [primary("A", "X"), backup("B", "X")],
    });
    expect(issuesOf(generateRoster(covered).issues, "PENDING_LEAVE_CONFLICT")).toEqual([]);
  });

  it("PENDING and REJECTED leave never make anyone unavailable", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
      leaves: [
        leave("A", "2026-12-14", "2026-12-14", { status: "PENDING" }),
        leave("A", "2026-12-15", "2026-12-15", { status: "REJECTED" }),
      ],
    });
    const { draft } = generateRoster(input);
    for (const d of ["2026-12-14", "2026-12-15"])
      expect(["WORK", "WEEKLY_OFF"]).toContain(entry(draft, "A", d).status);
  });
});

describe("correctness traps", () => {
  it("a public holiday inside a leave is not charged to the leave: it is HOLIDAY", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
      holidays: [{ date: "2026-12-25", name: "Christmas" }],
      leaves: [leave("A", "2026-12-24", "2026-12-26")],
    });
    const { draft, issues } = generateRoster(input);
    expect(entry(draft, "A", "2026-12-24").status).toBe("LEAVE");
    expect(entry(draft, "A", "2026-12-25").status).toBe("HOLIDAY");
    expect(entry(draft, "A", "2026-12-26").status).toBe("LEAVE");
    expect(entry(draft, "B", "2026-12-25").status).toBe("WORK"); // ALL_DAYS still staffed
    expect(errors(issues)).toEqual([]);
  });

  it("leave spanning months (30 Dec to 2 Jan, with 1 Jan a holiday) is handled, and the thin week needs no weekly off", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
      holidays: [{ date: "2027-01-01", name: "New Year" }],
      leaves: [leave("A", "2026-12-30", "2027-01-02")],
    });
    const { draft, issues } = generateRoster(input);
    expect(entry(draft, "A", "2026-12-30").status).toBe("LEAVE");
    expect(entry(draft, "A", "2026-12-31").status).toBe("LEAVE");
    expect(entry(draft, "A", "2027-01-01").status).toBe("HOLIDAY"); // spill date, public holiday
    expect(entry(draft, "A", "2027-01-02").status).toBe("LEAVE");
    // only 28 and 29 Dec are available in December that week: fewer than 4, so no weekly off is required
    expect(issuesOf(issues, "WEEKLY_OFF_NOT_GRANTED").filter((i) => i.employeeId === "A")).toEqual(
      [],
    );
    expect(errors(issues)).toEqual([]);
  });

  it("an employee with zero assignments is a backup-pool member: works, gets weekly offs, raises nothing", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B"), emp("Z")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
    });
    const { draft, issues } = generateRoster(input);
    expect(errors(issues)).toEqual([]);
    expect(entry(draft, "Z", "2026-12-02")).toMatchObject({
      status: "WORK",
      coveredBrandProcessIds: [],
    });
    expect(offDates(draft, "Z").length).toBeGreaterThanOrEqual(5);
  });

  it("a brand-process with minimum 0 needs nobody, even when everyone assigned is on leave", () => {
    const input = makeInput({
      employees: [emp("A")],
      brandProcesses: [bp("X", { defaultMinStaff: 0 })],
      assignments: [primary("A", "X")],
      leaves: [leave("A", "2026-12-07", "2026-12-11")],
    });
    const { issues } = generateRoster(input);
    expect(issuesOf(issues, "COVERAGE_GAP")).toEqual([]);
    expect(issuesOf(issues, "NO_ELIGIBLE_STAFF")).toEqual([]);
  });

  it("an inactive employee is ignored entirely: no entries, no issues, never used as cover", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B"), emp("GONE", { isActive: false })],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X"), backup("GONE", "X")],
    });
    const { draft, issues } = generateRoster(input);
    expect(draft.entries.some((e) => e.employeeId === "GONE")).toBe(false);
    expect(issues.some((i) => i.employeeId === "GONE")).toBe(false);
    expect(errors(issues)).toEqual([]);
  });

  it("every employee has exactly one entry per planning-window date", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
    });
    const { draft } = generateRoster(input);
    // 2026-11-30 .. 2027-01-03 = 35 days
    expect(draft.entries).toHaveLength(2 * 35);
    expect(new Set(draft.entries.map((e) => `${e.employeeId}|${e.date}`)).size).toBe(
      draft.entries.length,
    );
    expect(draft.entries[0].date).toBe("2026-11-30");
  });

  it("weeklyOffsPerWeek 2 gives two offs per qualifying week", () => {
    const input = makeInput({
      employees: [emp("A", { weeklyOffsPerWeek: 2 }), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
    });
    const { draft, issues } = generateRoster(input);
    expect(errors(issues)).toEqual([]);
    const offs = offDates(draft, "A").filter((d) => d >= "2026-12-07" && d <= "2026-12-13");
    expect(offs).toHaveLength(2);
  });
});
