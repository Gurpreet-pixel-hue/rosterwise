import { describe, expect, it } from "vitest";
import {
  addDays,
  datesBetween,
  isOperating,
  monthDates,
  weekdayOf,
  weeksOfMonth,
} from "../calendar";
import type { Weekday } from "../types";

const PH = new Set(["2026-12-06" /* Sunday */, "2026-12-25" /* Friday */]);
const rule = (
  operatingRule: "ALL_DAYS" | "NO_PUBLIC_HOLIDAYS" | "NO_SUNDAY_NO_PH" | "CUSTOM",
  customWeekdays: Weekday[] = [],
  worksOnPublicHolidays = false,
) => ({ operatingRule, customWeekdays, worksOnPublicHolidays });

describe("date helpers (string dates, no local-timezone drift)", () => {
  it("weekdayOf", () => {
    expect(weekdayOf("2026-12-01")).toBe("TUE");
    expect(weekdayOf("2026-12-06")).toBe("SUN");
    expect(weekdayOf("2027-01-26")).toBe("TUE");
    expect(weekdayOf("2028-02-29")).toBe("TUE"); // leap day
  });

  it("addDays crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("datesBetween is inclusive and crosses a month and year boundary", () => {
    expect(datesBetween("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(datesBetween("2026-12-05", "2026-12-05")).toEqual(["2026-12-05"]);
    expect(datesBetween("2026-12-05", "2026-12-04")).toEqual([]);
  });

  it("monthDates lists every day of the month", () => {
    expect(monthDates("2026-12")).toHaveLength(31);
    expect(monthDates("2027-02")).toHaveLength(28);
    expect(monthDates("2028-02")).toHaveLength(29);
    expect(monthDates("2026-12")[0]).toBe("2026-12-01");
  });

  it("rejects malformed or impossible dates and months", () => {
    expect(() => weekdayOf("2026-13-01")).toThrow();
    expect(() => weekdayOf("2026-02-30")).toThrow();
    expect(() => weekdayOf("12/01/2026")).toThrow();
    expect(() => monthDates("2026-13")).toThrow();
  });
});

describe("isOperating", () => {
  it("ALL_DAYS operates every day, including Sundays and public holidays", () => {
    const bp = rule("ALL_DAYS");
    expect(isOperating(bp, "2026-12-06", PH)).toBe(true); // Sunday + PH
    expect(isOperating(bp, "2026-12-13", PH)).toBe(true); // plain Sunday
    expect(isOperating(bp, "2026-12-25", PH)).toBe(true); // weekday PH
  });

  it("NO_PUBLIC_HOLIDAYS operates every day except public holidays", () => {
    const bp = rule("NO_PUBLIC_HOLIDAYS");
    expect(isOperating(bp, "2026-12-13", PH)).toBe(true); // Sunday, not a PH
    expect(isOperating(bp, "2026-12-25", PH)).toBe(false);
    expect(isOperating(bp, "2026-12-06", PH)).toBe(false); // PH on a Sunday
  });

  it("NO_SUNDAY_NO_PH operates Mon-Sat excluding public holidays", () => {
    const bp = rule("NO_SUNDAY_NO_PH");
    expect(isOperating(bp, "2026-12-12", PH)).toBe(true); // Saturday
    expect(isOperating(bp, "2026-12-13", PH)).toBe(false); // Sunday
    expect(isOperating(bp, "2026-12-25", PH)).toBe(false); // weekday PH
    expect(isOperating(bp, "2026-12-06", PH)).toBe(false); // Sunday PH
  });

  it("CUSTOM operates on its weekdays; public holidays only if worksOnPublicHolidays", () => {
    const monSat: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const closedOnPh = rule("CUSTOM", monSat, false);
    const openOnPh = rule("CUSTOM", monSat, true);
    expect(isOperating(closedOnPh, "2026-12-14", PH)).toBe(true); // Monday
    expect(isOperating(closedOnPh, "2026-12-13", PH)).toBe(false); // Sunday not listed
    expect(isOperating(closedOnPh, "2026-12-25", PH)).toBe(false); // listed weekday but PH
    expect(isOperating(openOnPh, "2026-12-25", PH)).toBe(true);
    // worksOnPublicHolidays never adds a weekday that is not listed
    expect(isOperating(openOnPh, "2026-12-06", PH)).toBe(false);
  });

  it("CUSTOM with no weekdays never operates", () => {
    expect(isOperating(rule("CUSTOM", [], true), "2026-12-14", PH)).toBe(false);
  });
});

describe("weeksOfMonth (Mon-Sun weeks; a weekly off is required only if >= 4 days are in the month)", () => {
  it("December 2026: the boundary week 28 Dec - 3 Jan has 4 December days, so it requires an off in December", () => {
    const weeks = weeksOfMonth("2026-12");
    const last = weeks[weeks.length - 1];
    expect(last.monday).toBe("2026-12-28");
    expect(last.days).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"]);
    expect(last.requiresWeeklyOff).toBe(true);
    // first week starts Monday 30 Nov and has 6 December days
    expect(weeks[0].monday).toBe("2026-11-30");
    expect(weeks[0].days).toHaveLength(6);
    expect(weeks[0].requiresWeeklyOff).toBe(true);
    expect(weeks).toHaveLength(5);
  });

  it("January 2027: the same boundary week has only 3 January days, so it requires NO off in January", () => {
    const weeks = weeksOfMonth("2027-01");
    expect(weeks[0].monday).toBe("2026-12-28");
    expect(weeks[0].days).toEqual(["2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(weeks[0].requiresWeeklyOff).toBe(false);
    expect(weeks[weeks.length - 1].monday).toBe("2027-01-25");
    expect(weeks[weeks.length - 1].requiresWeeklyOff).toBe(true);
  });

  it("each boundary week requires an off in exactly one of the two months (never both, never neither)", () => {
    const dec = weeksOfMonth("2026-12").find((w) => w.monday === "2026-12-28")!;
    const jan = weeksOfMonth("2027-01").find((w) => w.monday === "2026-12-28")!;
    expect([dec.requiresWeeklyOff, jan.requiresWeeklyOff].filter(Boolean)).toHaveLength(1);
  });

  it("a month that starts on Monday and has 28 days is exactly four full weeks (Feb 2027)", () => {
    const weeks = weeksOfMonth("2027-02");
    expect(weeks).toHaveLength(4);
    expect(weeks.every((w) => w.days.length === 7 && w.requiresWeeklyOff)).toBe(true);
  });

  it("a single stray day is not a qualifying week (Nov 2026 ends on Monday 30 Nov)", () => {
    const weeks = weeksOfMonth("2026-11");
    const last = weeks[weeks.length - 1];
    expect(last.days).toEqual(["2026-11-30"]);
    expect(last.requiresWeeklyOff).toBe(false);
  });

  it("exposes the full Mon-Sun week, so an off can sit on a neighbouring-month day (Sunday 3 Jan for December's boundary week)", () => {
    const dec = weeksOfMonth("2026-12").find((w) => w.monday === "2026-12-28")!;
    expect(dec.fullWeek).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(dec.days).toHaveLength(4); // only these four are December roster days
    for (const w of weeksOfMonth("2026-12")) {
      expect(w.fullWeek).toHaveLength(7);
      expect(weekdayOf(w.fullWeek[0])).toBe("MON");
      expect(weekdayOf(w.fullWeek[6])).toBe("SUN");
    }
  });

  it("every day of the month appears in exactly one week", () => {
    const all = weeksOfMonth("2026-12").flatMap((w) => w.days);
    expect(all).toEqual(monthDates("2026-12"));
  });
});
