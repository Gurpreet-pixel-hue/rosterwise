import { describe, expect, it } from "vitest";
import { datesBetween, weeksOfMonth } from "../calendar";
import { simulateChange } from "../change";
import { diffRosters } from "../diff";
import { explainIssue } from "../explain";
import { generateRoster } from "../generate";
import { ISSUE_SEVERITY, type EngineInput, type Issue, type IssueCode } from "../types";
import { entry, errors, issuesOf } from "./fixtures";
import { seedInput } from "./seedInput";

const DEC = "2026-12";
const base = () => {
  const input = seedInput(DEC);
  return { input, current: generateRoster(input) };
};
const bpId = (input: EngineInput, brand: string, code: string) =>
  input.brandProcesses.find((b) => b.brandName === brand && b.processCode === code)!.id;

describe("simulateChange (assessment section F), without saving", () => {
  it("approving Aarav's pending leave: CASCADE_GAP on two brands, a backup absorbs the third, only that week is re-planned", () => {
    const { input, current } = base();
    const pending = input.leaves.find((l) => l.status === "PENDING")!;
    const before = structuredClone(input);

    const r = simulateChange(input, current, {
      type: "ADD_LEAVE",
      leave: { ...pending, status: "APPROVED" },
    });

    // nothing is saved or mutated
    expect(input).toEqual(before);
    expect(r.newInput).not.toBe(input);

    // the Mon-Sun week of 28 Dec is the only one re-planned
    expect(r.replannedWeeks).toEqual(["2026-12-28"]);
    const week = new Set(weeksOfMonth(DEC).find((w) => w.monday === "2026-12-28")!.fullWeek);
    expect(r.changedCells.length).toBeGreaterThan(0);
    expect(r.changedCells.every((c) => week.has(c.date))).toBe(true);
    for (const e of current.draft.entries.filter((x) => !week.has(x.date))) {
      expect(entry(r.newDraft, e.employeeId, e.date)).toEqual(e); // every other week is untouched
    }

    // CASCADE_GAP: Lumen Skincare and Verdant Tea Co, not Atlas Footwear (Rahul Bhatt covers it)
    const cascade = r.issueDelta.added.filter((i) => i.code === "CASCADE_GAP");
    expect(cascade.map((c) => c.date)).toEqual(["2026-12-29", "2026-12-30"]);
    for (const c of cascade) {
      expect(c.employeeId).toBe("emp-aarav-sharma");
      expect(c.message).toContain("Lumen Skincare");
      expect(c.message).toContain("Verdant Tea Co");
      expect(c.message).not.toContain("Atlas Footwear");
    }
    const atlas = bpId(input, "Atlas Footwear", "CS");
    expect(entry(r.newDraft, "emp-rahul-bhatt", "2026-12-29").coveredBrandProcessIds).toContain(
      atlas,
    );

    // the pending-leave warning is resolved (the leave is no longer pending) and help is offered
    expect(r.issueDelta.resolved.some((i) => i.code === "PENDING_LEAVE_CONFLICT")).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.map((s) => s.type)).toContain("REASSIGN_FROM_POD");
  });

  it("a second simultaneous leave in the 3-person brand creates the gap the first one did not (scenario 3)", () => {
    const { input, current } = base();
    // Arjun is already on leave 16-17 Dec; Pooja also being away on the 17th leaves 1 of 2.
    const r = simulateChange(input, current, {
      type: "MAKE_UNAVAILABLE",
      employeeId: "emp-pooja-desai",
      fromDate: "2026-12-17",
      toDate: "2026-12-17",
    });
    const gap = r.issueDelta.added.find((i) => i.code === "COVERAGE_GAP");
    expect(gap).toBeDefined();
    expect(gap!.date).toBe("2026-12-17");
    expect(gap!.message).toContain("Orbit Electronics / CS");
    expect(gap!.message).toContain("has 1 of 2");
    expect(current.issues.filter((i) => i.code === "COVERAGE_GAP")).toEqual([]); // the baseline had none
  });

  it("removing a leave frees the employee again and adds no ERROR", () => {
    const { input, current } = base();
    const ishita = input.leaves.find((l) => l.employeeId === "emp-ishita-verma")!;
    const r = simulateChange(input, current, { type: "REMOVE_LEAVE", leaveId: ishita.id });
    expect(entry(r.newDraft, "emp-ishita-verma", "2026-12-22").status).not.toBe("LEAVE");
    expect(errors(r.issueDelta.added)).toEqual([]);
    expect(r.replannedWeeks).toEqual(["2026-12-21"]);
  });

  it("a one-day minimum-staff override re-plans only that week", () => {
    const { input, current } = base();
    const cs = bpId(input, "Coastal Candles", "CS");
    const r = simulateChange(input, current, {
      type: "CHANGE_MIN_STAFF",
      brandProcessId: cs,
      override: { date: "2026-12-08", minStaff: 2 },
    });
    expect(r.replannedWeeks).toEqual(["2026-12-07"]);
    // both Ishita and Divya now work that Tuesday
    expect(entry(r.newDraft, "emp-ishita-verma", "2026-12-08").coveredBrandProcessIds).toContain(
      cs,
    );
    expect(entry(r.newDraft, "emp-divya-menon", "2026-12-08").coveredBrandProcessIds).toContain(cs);
    expect(errors(r.issueDelta.added)).toEqual([]);
  });

  it("changing a brand's operating rule is previewed, not applied, and re-plans the whole month", () => {
    const { input, current } = base();
    const cs = bpId(input, "Coastal Candles", "CS");
    const r = simulateChange(input, current, {
      type: "CHANGE_RULE",
      brandProcessId: cs,
      patch: { operatingRule: "NO_SUNDAY_NO_PH" },
    });
    expect(input.brandProcesses.find((b) => b.id === cs)!.operatingRule).toBe("ALL_DAYS");
    expect(r.newInput.brandProcesses.find((b) => b.id === cs)!.operatingRule).toBe(
      "NO_SUNDAY_NO_PH",
    );
    expect(r.replannedWeeks.length).toBe(weeksOfMonth(DEC).length);
    expect(errors(r.issueDelta.added)).toEqual([]);
  });

  it("dates before today are history: a change cannot rewrite them", () => {
    const { input, current } = base();
    const withToday: EngineInput = { ...input, today: "2026-12-16" };
    const r = simulateChange(withToday, current, {
      type: "MAKE_UNAVAILABLE",
      employeeId: "emp-pooja-desai",
      fromDate: "2026-12-10",
      toDate: "2026-12-18",
    });
    for (const d of datesBetween("2026-11-30", "2026-12-15")) {
      expect(entry(r.newDraft, "emp-pooja-desai", d)).toEqual(
        entry(current.draft, "emp-pooja-desai", d),
      );
    }
    expect(entry(r.newDraft, "emp-pooja-desai", "2026-12-17").status).toBe("LEAVE");
  });
});

describe("diffRosters", () => {
  it("identical rosters have no changes", () => {
    const { current } = base();
    const d = diffRosters(current, current);
    expect(d.changedCells).toEqual([]);
    expect(d.issueDelta).toEqual({ added: [], resolved: [] });
  });

  it("reports changed cells and matches issues by stable id", () => {
    const { input, current } = base();
    const pending = input.leaves.find((l) => l.status === "PENDING")!;
    const r = simulateChange(input, current, {
      type: "ADD_LEAVE",
      leave: { ...pending, status: "APPROVED" },
    });
    const d = diffRosters(current, { draft: r.newDraft, issues: r.newIssues });
    expect(d.changedCells).toEqual(r.changedCells);
    const aaravDay = d.changedCells.find(
      (c) => c.employeeId === "emp-aarav-sharma" && c.date === "2026-12-29",
    )!;
    expect(aaravDay.before?.status).toBe("WORK");
    expect(aaravDay.after?.status).toBe("LEAVE");
    // an issue that exists on both sides is neither added nor resolved
    const stillThere = current.issues.find(
      (i) => i.code === "WEEKLY_OFF_NOT_GRANTED" && i.employeeId === "emp-ananya-reddy",
    )!;
    expect(d.issueDelta.added.some((i) => i.id === stillThere.id)).toBe(false);
    expect(d.issueDelta.resolved.some((i) => i.id === stillThere.id)).toBe(false);
  });

  it("issue ids are stable across regeneration", () => {
    const a = generateRoster(seedInput(DEC)).issues.map((i) => i.id);
    const b = generateRoster(seedInput(DEC)).issues.map((i) => i.id);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBe(a.length); // and unique
  });
});

describe("explainIssue is deterministic and specific", () => {
  const fake = (code: IssueCode): Issue => ({
    id: `x-${code}`,
    code,
    severity: ISSUE_SEVERITY[code],
    message: `message for ${code}`,
    employeeId: "emp-ananya-reddy",
    date: "2026-12-09",
    suggestions: [],
  });

  it("covers every issue code and always includes the issue's own message", () => {
    const input = seedInput(DEC);
    for (const code of Object.keys(ISSUE_SEVERITY) as IssueCode[]) {
      const text = explainIssue(fake(code), input);
      expect(text.length).toBeGreaterThan(20);
      expect(text).toContain(`message for ${code}`);
    }
  });

  it("explains Ananya Reddy's missing weekly off by naming the brands she alone covers", () => {
    const { input, current } = base();
    const issue = issuesOf(current.issues, "WEEKLY_OFF_NOT_GRANTED").find(
      (i) => i.employeeId === "emp-ananya-reddy",
    )!;
    const text = explainIssue(issue, input);
    expect(text).toContain("Ananya Reddy");
    expect(text).toContain("Nimbus Gadgets / CS");
    expect(text).toContain("Nimbus Gadgets / NDR");
    expect(text).toContain("coverage wins");
    expect(explainIssue(issue, input)).toBe(text);
  });
});
