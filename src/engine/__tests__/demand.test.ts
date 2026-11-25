import { describe, expect, it } from "vitest";
import { expandDemand, indexOverrides, requiredStaff } from "../demand";
import type { BrandProcessDemandInput } from "../types";

const holidays = new Set(["2026-12-25"]);
const bp = (over: Partial<BrandProcessDemandInput> = {}): BrandProcessDemandInput => ({
  id: "bp1",
  operatingRule: "ALL_DAYS",
  customWeekdays: [],
  worksOnPublicHolidays: false,
  defaultMinStaff: 1,
  weekdayMinStaff: null,
  ...over,
});
const ctx = (
  overrides: Array<{ brandProcessId: string; date: string; minStaff: number }> = [],
) => ({
  holidays,
  overrides: indexOverrides(overrides),
});

describe("requiredStaff resolution: CoverageOverride -> weekdayMinStaff -> defaultMinStaff, only if operating", () => {
  it("falls back to defaultMinStaff", () => {
    expect(requiredStaff(bp({ defaultMinStaff: 3 }), "2026-12-14", ctx())).toBe(3);
  });

  it("weekdayMinStaff beats the default on that weekday only", () => {
    const b = bp({ defaultMinStaff: 1, weekdayMinStaff: { MON: 2 } });
    expect(requiredStaff(b, "2026-12-14", ctx())).toBe(2); // Monday
    expect(requiredStaff(b, "2026-12-15", ctx())).toBe(1); // Tuesday
  });

  it("a CoverageOverride beats the weekday minimum and the default", () => {
    const b = bp({ defaultMinStaff: 1, weekdayMinStaff: { SAT: 2 } });
    const o = [{ brandProcessId: "bp1", date: "2026-12-12", minStaff: 3 }]; // a Saturday
    expect(requiredStaff(b, "2026-12-12", ctx(o))).toBe(3);
    expect(requiredStaff(b, "2026-12-19", ctx(o))).toBe(2); // another Saturday, no override
  });

  it("an override can lower the requirement below the default", () => {
    const o = [{ brandProcessId: "bp1", date: "2026-12-14", minStaff: 1 }];
    expect(requiredStaff(bp({ defaultMinStaff: 2 }), "2026-12-14", ctx(o))).toBe(1);
  });

  it("an explicit 0 is respected at every level (a brand-process with min 0)", () => {
    expect(requiredStaff(bp({ defaultMinStaff: 0 }), "2026-12-14", ctx())).toBe(0);
    expect(
      requiredStaff(bp({ defaultMinStaff: 2, weekdayMinStaff: { MON: 0 } }), "2026-12-14", ctx()),
    ).toBe(0);
    const o = [{ brandProcessId: "bp1", date: "2026-12-14", minStaff: 0 }];
    expect(requiredStaff(bp({ defaultMinStaff: 2 }), "2026-12-14", ctx(o))).toBe(0);
  });

  it("is 0 when the brand-process is not operating, even with an override", () => {
    const b = bp({ operatingRule: "NO_PUBLIC_HOLIDAYS", defaultMinStaff: 2 });
    const o = [{ brandProcessId: "bp1", date: "2026-12-25", minStaff: 5 }];
    expect(requiredStaff(b, "2026-12-25", ctx(o))).toBe(0); // public holiday
    expect(
      requiredStaff(bp({ operatingRule: "NO_SUNDAY_NO_PH" }), "2026-12-13", ctx()), // Sunday
    ).toBe(0);
  });

  it("an override for a different brand-process or date is ignored", () => {
    const o = [
      { brandProcessId: "other", date: "2026-12-14", minStaff: 9 },
      { brandProcessId: "bp1", date: "2026-12-15", minStaff: 9 },
    ];
    expect(requiredStaff(bp(), "2026-12-14", ctx(o))).toBe(1);
  });

  it("ignores a weekday minimum for a weekday that is not a working day (CUSTOM)", () => {
    const b = bp({
      operatingRule: "CUSTOM",
      customWeekdays: ["MON", "TUE"],
      weekdayMinStaff: { WED: 4, MON: 2 },
    });
    expect(requiredStaff(b, "2026-12-16", ctx())).toBe(0); // Wednesday: not operating
    expect(requiredStaff(b, "2026-12-14", ctx())).toBe(2);
  });
});

describe("expandDemand", () => {
  it("returns Map<bpId, Map<date, required>> covering every requested date", () => {
    const b1 = bp({ id: "a", operatingRule: "NO_SUNDAY_NO_PH", weekdayMinStaff: { MON: 2 } });
    const b2 = bp({ id: "b", defaultMinStaff: 0 });
    const dates = ["2026-12-13", "2026-12-14", "2026-12-15"]; // Sun, Mon, Tue
    const demand = expandDemand([b1, b2], dates, ctx());
    expect([...demand.keys()]).toEqual(["a", "b"]);
    expect([...demand.get("a")!.entries()]).toEqual([
      ["2026-12-13", 0],
      ["2026-12-14", 2],
      ["2026-12-15", 1],
    ]);
    expect([...demand.get("b")!.values()]).toEqual([0, 0, 0]);
  });
});
