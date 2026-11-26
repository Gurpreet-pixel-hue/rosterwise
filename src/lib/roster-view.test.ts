import { describe, expect, it } from "vitest";
import type { DraftEntry, Issue } from "@/engine/types";
import type { RosterRefs } from "@/server/pageData";
import {
  carriedOffWarning,
  dayLabel,
  mondayOf,
  weekOwnerMonth,
  filterOptions,
  groupBySeverity,
  issueTarget,
  issuesByBpDay,
  issuesByCell,
  monthTitle,
  pendingLeaveOn,
  shiftMonth,
  visibleBrandProcesses,
  visibleEmployees,
  weekdayShort,
  whoIsWorking,
  worstSeverity,
} from "./roster-view";

const emp = (id: string, podId: string, isActive = true) => ({
  id,
  name: id.toUpperCase(),
  podId,
  isActive,
  preferredOffDays: [],
  fixedOffDays: [],
});
const bp = (id: string, brandId: string, brandPodId: string, processCode: string) => ({
  id,
  brandId,
  brandName: brandId.toUpperCase(),
  brandPodId,
  processCode,
  operatingRule: "ALL_DAYS",
  defaultMinStaff: 1,
  shiftStart: "09:00",
  shiftEnd: "18:00",
});

const refs: RosterRefs = {
  pods: [
    { id: "p1", name: "Pod One", leadId: null },
    { id: "p2", name: "Pod Two", leadId: null },
  ],
  employees: [
    emp("a", "p1"),
    emp("b", "p1"),
    emp("c", "p2"),
    emp("d", "p2"),
    emp("gone", "p1", false),
  ],
  brands: [
    { id: "x", name: "X", podId: "p1" },
    { id: "y", name: "Y", podId: "p2" },
  ],
  brandProcesses: [
    bp("x-cs", "x", "p1", "CS"),
    bp("x-acc", "x", "p1", "ACC"),
    bp("y-cs", "y", "p2", "CS"),
  ],
  assignments: [
    { employeeId: "a", brandProcessId: "x-cs", role: "PRIMARY", allocationPct: 100 },
    { employeeId: "a", brandProcessId: "x-acc", role: "PRIMARY", allocationPct: 100 },
    { employeeId: "c", brandProcessId: "y-cs", role: "PRIMARY", allocationPct: 100 },
    { employeeId: "b", brandProcessId: "y-cs", role: "BACKUP", allocationPct: 50 },
  ],
  holidays: [{ date: "2026-12-25", name: "Christmas" }],
  leaves: [
    {
      id: "l1",
      employeeId: "a",
      fromDate: "2026-12-10",
      toDate: "2026-12-12",
      type: "PLANNED",
      status: "PENDING",
    },
    {
      id: "l2",
      employeeId: "a",
      fromDate: "2026-12-20",
      toDate: "2026-12-21",
      type: "PLANNED",
      status: "APPROVED",
    },
  ],
};
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

describe("the five views", () => {
  it("Company shows everyone active and every brand-process; no filter", () => {
    expect(filterOptions("company", refs)).toEqual([]);
    expect(ids(visibleEmployees("company", "", refs))).toEqual(["a", "b", "c", "d"]);
    expect(ids(visibleBrandProcesses("company", "", refs))).toEqual(["x-cs", "x-acc", "y-cs"]);
  });

  it("Pod shows that pod's people and its brands' processes", () => {
    expect(filterOptions("pod", refs).map((o) => o.label)).toEqual(["Pod One", "Pod Two"]);
    expect(ids(visibleEmployees("pod", "p2", refs))).toEqual(["c", "d"]);
    expect(ids(visibleBrandProcesses("pod", "p2", refs))).toEqual(["y-cs"]);
  });

  it("Brand shows everyone assigned to it, primary or backup, even from another pod", () => {
    expect(ids(visibleEmployees("brand", "y", refs))).toEqual(["b", "c"]); // b is Pod One's backup for Y
    expect(ids(visibleEmployees("brand", "x", refs))).toEqual(["a"]);
    expect(ids(visibleBrandProcesses("brand", "x", refs))).toEqual(["x-cs", "x-acc"]);
  });

  it("Process groups by process code across brands", () => {
    expect(filterOptions("process", refs).map((o) => o.value)).toEqual(["ACC", "CS"]);
    expect(ids(visibleBrandProcesses("process", "CS", refs))).toEqual(["x-cs", "y-cs"]);
    expect(ids(visibleEmployees("process", "CS", refs))).toEqual(["a", "b", "c"]);
  });

  it("Employee shows one person and the brand-processes they are assigned to; inactive staff never appear", () => {
    expect(filterOptions("employee", refs).map((o) => o.value)).toEqual(["a", "b", "c", "d"]);
    expect(ids(visibleEmployees("employee", "a", refs))).toEqual(["a"]);
    expect(ids(visibleBrandProcesses("employee", "a", refs))).toEqual(["x-cs", "x-acc"]);
    expect(ids(visibleEmployees("employee", "gone", refs))).toEqual([]);
    expect(ids(visibleBrandProcesses("employee", "d", refs))).toEqual([]); // d has no assignments: the bench
  });
});

describe("who is working on a date", () => {
  const e = (
    employeeId: string,
    status: DraftEntry["status"],
    covered: string[] = [],
  ): DraftEntry => ({
    employeeId,
    date: "2026-12-25",
    status,
    coveredBrandProcessIds: covered,
    locked: false,
    source: "AUTO",
  });
  const entries = [
    e("a", "WORK", ["x-cs", "x-acc"]),
    e("b", "WORK"),
    e("c", "WEEKLY_OFF"),
    e("d", "HOLIDAY"),
    e("gone", "WORK", ["x-cs"]),
    { ...e("a", "WORK", ["x-cs"]), date: "2026-12-26" },
  ];

  it("groups working, bench (working but covering nothing) and off; names the holiday", () => {
    const p = whoIsWorking("2026-12-25", entries, refs);
    expect(p.holiday).toBe("Christmas");
    expect(p.working.map((r) => [r.employeeId, r.covering])).toEqual([
      ["a", ["X / ACC", "X / CS"]],
    ]);
    expect(p.bench.map((r) => r.employeeId)).toEqual(["b"]);
    expect(p.off.map((r) => [r.employeeId, r.status])).toEqual([
      ["d", "HOLIDAY"], // grouped by status, then by name
      ["c", "WEEKLY_OFF"],
    ]);
  });

  it("ignores other days and inactive staff", () => {
    const p = whoIsWorking("2026-12-26", entries, refs);
    expect(p.working.map((r) => r.employeeId)).toEqual(["a"]);
    expect(p.holiday).toBeNull();
    expect([...p.working, ...p.bench, ...p.off].some((r) => r.employeeId === "gone")).toBe(false);
  });
});

describe("issue lookups", () => {
  const issue = (over: Partial<Issue>): Issue => ({
    id: "i",
    code: "COVERAGE_GAP",
    severity: "ERROR",
    message: "m",
    suggestions: [],
    ...over,
  });
  it("indexes issues by person+day and by brand-process+day, and finds where to jump", () => {
    const gap = issue({ id: "g", brandProcessId: "x-cs", date: "2026-12-16" });
    const off = issue({
      id: "o",
      code: "WEEKLY_OFF_NOT_GRANTED",
      employeeId: "a",
      date: "2026-12-16",
    });
    const both = issue({
      id: "b",
      employeeId: "a",
      brandProcessId: "x-cs",
      date: "2026-12-16",
      severity: "WARNING",
    });
    expect(
      issuesByCell([gap, off, both])
        .get("a|2026-12-16")
        ?.map((i) => i.id),
    ).toEqual(["o", "b"]);
    expect(
      issuesByBpDay([gap, off, both])
        .get("x-cs|2026-12-16")
        ?.map((i) => i.id),
    ).toEqual(["g", "b"]);
    expect(issueTarget(gap)).toEqual({ kind: "strip", bpId: "x-cs", date: "2026-12-16" });
    expect(issueTarget(off)).toEqual({ kind: "cell", employeeId: "a", date: "2026-12-16" });
    expect(issueTarget(issue({}))).toBeNull();
  });

  it("ranks severity and groups ERROR, WARNING, INFO in that order", () => {
    const e = issue({ id: "e" });
    const w = issue({ id: "w", severity: "WARNING" });
    const i = issue({ id: "i", severity: "INFO" });
    expect(worstSeverity([i, w])).toBe("WARNING");
    expect(worstSeverity([i, w, e])).toBe("ERROR");
    expect(worstSeverity([i])).toBe("INFO");
    expect(worstSeverity([])).toBeNull();
    expect(groupBySeverity([i, e, w]).map((g) => [g.severity, g.issues.map((x) => x.id)])).toEqual([
      ["ERROR", ["e"]],
      ["WARNING", ["w"]],
      ["INFO", ["i"]],
    ]);
  });
});

describe("small helpers", () => {
  it("only PENDING leave raises the chip, and only inside its dates", () => {
    expect(pendingLeaveOn("a", "2026-12-11", refs)?.id).toBe("l1");
    expect(pendingLeaveOn("a", "2026-12-13", refs)).toBeUndefined();
    expect(pendingLeaveOn("a", "2026-12-20", refs)).toBeUndefined(); // approved leave is applied, not a chip
  });
  it("month and weekday maths never depend on the viewer's timezone", () => {
    expect(monthTitle("2026-12")).toBe("December 2026");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(weekdayShort("2027-01-03")).toBe("SUN");
    expect(weekdayShort("2026-12-25")).toBe("FRI");
  });
});

describe("boundary-week ownership in the UI", () => {
  it("the week of 28 Dec belongs to December, however you look at it; mid-month weeks to their month", () => {
    expect(mondayOf("2027-01-03")).toBe("2026-12-28");
    for (const d of ["2026-12-28", "2026-12-31", "2027-01-01", "2027-01-03"])
      expect(weekOwnerMonth(d)).toBe("2026-12");
    expect(weekOwnerMonth("2027-01-04")).toBe("2027-01");
    expect(weekOwnerMonth("2026-11-30")).toBe("2026-12"); // Mon 30 Nov week has 6 December days
    expect(weekOwnerMonth("2026-12-16")).toBe("2026-12");
  });
  it("warns only when a January cell serves December's week", () => {
    const w = carriedOffWarning("Aarav Sharma", "2027-01-03", "2027-01")!;
    expect(w.ownerMonth).toBe("2026-12");
    expect(w.text).toBe(
      "This is Aarav Sharma's weekly off for December 2026's week of Mon 28 Dec. Changing it puts an ERROR on the December 2026 roster unless they get another off that week.",
    );
    expect(carriedOffWarning("Aarav Sharma", "2027-01-10", "2027-01")).toBeNull();
    expect(carriedOffWarning("Aarav Sharma", "2027-01-03", "2026-12")).toBeNull(); // December's own week
    expect(dayLabel("2026-12-28")).toBe("Mon 28 Dec");
  });
});
