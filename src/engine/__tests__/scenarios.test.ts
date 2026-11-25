import { describe, expect, it } from "vitest";
import { analyzeRoster } from "../analyze";
import { datesBetween, monthDates, weekdayOf, weeksOfMonth } from "../calendar";
import { requiredStaff, indexOverrides } from "../demand";
import { applyEdits } from "../edit";
import { generateRoster } from "../generate";
import { applySuggestion } from "../suggest";
import type { DraftEntry, EngineInput, Issue } from "../types";
import { validateRoster } from "../validate";
import {
  backup,
  bp,
  coverageOf,
  emp,
  entry,
  errors,
  issuesOf,
  leave,
  makeInput,
  offDates,
  primary,
} from "./fixtures";
import { seedInput } from "./seedInput";

const DEC = monthDates("2026-12");
const inDec = (d: string) => d.startsWith("2026-12");
const ids = (issues: Issue[]) => issues.map((i) => i.id).sort();

describe("engine scenarios", () => {
  it("S01 single-resource ALL_DAYS brand with backup: primary weekly off covered by backup, zero ERRORs", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
    });
    const { draft, issues } = generateRoster(input);

    expect(errors(issues)).toEqual([]);
    // coverage is met on every single day of the planning window, computed independently
    for (const w of weeksOfMonth("2026-12")) {
      for (const d of w.fullWeek)
        expect(coverageOf(input, draft, "X", d)).toBeGreaterThanOrEqual(1);
    }
    // A has a weekly off in every owned week, and B covers X on each of those days
    for (const w of weeksOfMonth("2026-12").filter((x) => x.requiresWeeklyOff)) {
      const offs = w.fullWeek.filter((d) => entry(draft, "A", d).status === "WEEKLY_OFF");
      expect(offs.length).toBeGreaterThanOrEqual(1);
      for (const d of offs) {
        expect(entry(draft, "B", d).status).toBe("WORK");
        expect(entry(draft, "B", d).coveredBrandProcessIds).toContain("X");
      }
    }
  });

  it("S02 single-resource ALL_DAYS brand without backup: WEEKLY_OFF_NOT_GRANTED or COVERAGE_GAP raised, never silent", () => {
    const input = makeInput({
      employees: [emp("A")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X")],
    });
    const { draft, issues } = generateRoster(input);

    // the roster stays valid (A works every day, so there is no coverage hole)...
    for (const d of DEC) expect(coverageOf(input, draft, "X", d)).toBe(1);
    expect(offDates(draft, "A")).toEqual([]);
    // ...but the missing weekly off is surfaced, once per owned week, naming the employee
    const missing = issuesOf(issues, "WEEKLY_OFF_NOT_GRANTED");
    expect(missing).toHaveLength(weeksOfMonth("2026-12").filter((w) => w.requiresWeeklyOff).length);
    expect(missing.every((i) => i.severity === "ERROR" && i.employeeId === "A")).toBe(true);
    expect(missing[0].message).toContain("A");
    expect(errors(issues).length).toBeGreaterThan(0);
  });

  it("S03 three-employee brand, one on leave: min 1 shared process -> no gap; min 2 -> COVERAGE_GAP", () => {
    // NOTE: with 3 people, ONE leave leaves 2 and can never break a minimum of 2. The case the name
    // means (PDF scenario 3, seeded as Orbit Electronics) is a SECOND simultaneous leave, so that is
    // what the min-2 half of this test uses. Both halves are asserted against the same roster shape.
    const base = (min: number, leaves: ReturnType<typeof leave>[]) =>
      makeInput({
        employees: [emp("A"), emp("B"), emp("C")],
        brandProcesses: [bp("X", { defaultMinStaff: min })],
        assignments: [primary("A", "X"), primary("B", "X"), primary("C", "X")],
        leaves,
      });

    // one leave, min 1: absorbed
    const one = base(1, [leave("A", "2026-12-09", "2026-12-09")]);
    const r1 = generateRoster(one);
    expect(issuesOf(r1.issues, "COVERAGE_GAP")).toEqual([]);
    expect(entry(r1.draft, "A", "2026-12-09").status).toBe("LEAVE");

    // one leave, min 2: still absorbed by the other two
    const r2 = generateRoster(base(2, [leave("A", "2026-12-09", "2026-12-09")]));
    expect(issuesOf(r2.issues, "COVERAGE_GAP")).toEqual([]);
    expect(coverageOf(base(2, []), r2.draft, "X", "2026-12-09")).toBe(2);

    // a second simultaneous leave, min 1: C alone is enough
    const two = [leave("A", "2026-12-09", "2026-12-09"), leave("B", "2026-12-09", "2026-12-09")];
    expect(issuesOf(generateRoster(base(1, two)).issues, "COVERAGE_GAP")).toEqual([]);

    // a second simultaneous leave, min 2: COVERAGE_GAP, on that date only, "has 1 of 2"
    const r4 = generateRoster(base(2, two));
    const gaps = issuesOf(r4.issues, "COVERAGE_GAP");
    expect(gaps.map((g) => g.date)).toEqual(["2026-12-09"]);
    expect(gaps[0].message).toContain("has 1 of 2");
    expect(coverageOf(base(2, two), r4.draft, "X", "2026-12-09")).toBe(1);
  });

  it("S04 NO_SUNDAY_NO_PH process: no demand on Sun/PH; weekly off lands on Sunday", () => {
    const holidays = [
      { date: "2026-12-06", name: "Sunday festival" }, // a public holiday ON a Sunday
      { date: "2026-12-25", name: "Christmas" }, // a Friday
    ];
    const proc = bp("N", { operatingRule: "NO_SUNDAY_NO_PH" });
    const input = makeInput({
      employees: [emp("A")],
      brandProcesses: [proc],
      assignments: [primary("A", "N")],
      holidays,
    });
    const { draft, issues } = generateRoster(input);

    const ctx = { holidays: new Set(holidays.map((h) => h.date)), overrides: indexOverrides([]) };
    const demandProc = { ...proc, id: "N" };
    for (const d of DEC) {
      const closed = weekdayOf(d) === "SUN" || ctx.holidays.has(d);
      expect(requiredStaff(demandProc, d, ctx)).toBe(closed ? 0 : 1);
    }
    expect(errors(issues)).toEqual([]);
    // every weekly off is a Sunday (including the Sunday that is also a public holiday)
    const offs = offDates(draft, "A");
    expect(offs.length).toBeGreaterThanOrEqual(5);
    expect(offs.every((d) => weekdayOf(d) === "SUN")).toBe(true);
    expect(offs).toContain("2026-12-06");
    // the weekday public holiday is a HOLIDAY, not work and not a weekly off
    expect(entry(draft, "A", "2026-12-25").status).toBe("HOLIDAY");
  });

  it("S05 public holiday: ALL_DAYS staffed + COMP_OFF_EARNED; NO_PUBLIC_HOLIDAYS not staffed", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B"), emp("C"), emp("D")],
      brandProcesses: [bp("ALL"), bp("NOPH", { operatingRule: "NO_PUBLIC_HOLIDAYS" })],
      assignments: [
        primary("A", "ALL"),
        backup("B", "ALL"),
        primary("C", "NOPH"),
        backup("D", "NOPH"),
      ],
      holidays: [{ date: "2026-12-25", name: "Christmas" }],
    });
    const { draft, issues } = generateRoster(input);

    expect(coverageOf(input, draft, "ALL", "2026-12-25")).toBe(1); // staffed
    expect(coverageOf(input, draft, "NOPH", "2026-12-25")).toBe(0); // closed
    expect(entry(draft, "C", "2026-12-25").status).toBe("HOLIDAY");
    expect(entry(draft, "D", "2026-12-25").status).toBe("HOLIDAY");
    // whoever worked the holiday earned a comp-off credit, reported as INFO and stored in the draft
    const worked = draft.entries.filter((e) => e.date === "2026-12-25" && e.status === "WORK");
    expect(worked).toHaveLength(1);
    const earned = issuesOf(issues, "COMP_OFF_EARNED");
    expect(earned).toHaveLength(1);
    expect(earned[0].severity).toBe("INFO");
    expect(earned[0].employeeId).toBe(worked[0].employeeId);
    expect(draft.compOffEarned).toEqual([
      expect.objectContaining({ employeeId: worked[0].employeeId, earnedOn: "2026-12-25" }),
    ]);
    expect(errors(issues)).toEqual([]);
  });

  it("S06 CoverageOverride raises min to 2 on one date and is enforced", () => {
    const make = (people: string[]) =>
      makeInput({
        employees: people.map((p) => emp(p)),
        brandProcesses: [bp("X")],
        assignments: people.map((p) => primary(p, "X")),
        coverageOverrides: [{ brandProcessId: "X", date: "2026-12-12", minStaff: 2 }],
      });

    const three = make(["A", "B", "C"]);
    const r = generateRoster(three);
    expect(coverageOf(three, r.draft, "X", "2026-12-12")).toBeGreaterThanOrEqual(2);
    expect(coverageOf(three, r.draft, "X", "2026-12-14")).toBeGreaterThanOrEqual(1);
    expect(errors(r.issues)).toEqual([]);

    // with one person the override cannot be met: it is a COVERAGE_GAP on exactly that date
    const one = make(["A"]);
    const gaps = issuesOf(generateRoster(one).issues, "COVERAGE_GAP");
    expect(gaps.map((g) => g.date)).toEqual(["2026-12-12"]);
    expect(gaps[0].message).toContain("has 1 of 2");
  });

  it("S07 manual edit makes sole cover OFF -> COVERAGE_GAP with USE_BACKUP/SWAP_OFF_DAY suggestions", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B"), emp("C")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X"), backup("C", "X")],
    });
    const { draft } = generateRoster(input);
    // pick a day on which B has its weekly off (and A is working), then manually give A the day off too
    const day = offDates(draft, "B").find(
      (d) => inDec(d) && entry(draft, "A", d).status === "WORK",
    )!;
    expect(day).toBeTruthy();
    const edited = applyEdits(
      draft,
      [{ employeeId: "A", date: day, status: "WEEKLY_OFF", coveredBrandProcessIds: [] }],
      { locked: true, source: "MANUAL" },
    );
    expect(entry(edited, "A", day)).toMatchObject({
      status: "WEEKLY_OFF",
      locked: true,
      source: "MANUAL",
    });

    const issues = analyzeRoster(input, edited);
    const gap = issuesOf(issues, "COVERAGE_GAP").find((i) => i.date === day)!;
    expect(gap).toBeDefined();
    expect(gap.severity).toBe("ERROR");
    expect(gap.message).toContain("has 0 of 1");
    const types = gap.suggestions.map((s) => s.type);
    expect(types).toContain("USE_BACKUP");
    expect(types).toContain("SWAP_OFF_DAY");
    expect(types).toContain("ACCEPT_GAP");
    expect(gap.suggestions.find((s) => s.type === "USE_BACKUP")!.employeeId).toBe("C");
    expect(gap.suggestions.find((s) => s.type === "SWAP_OFF_DAY")!.employeeId).toBe("B");
  });

  it("S08 employee covering 3 brands goes on leave -> CASCADE_GAP lists all 3 brands", () => {
    const input = makeInput({
      employees: [emp("E")],
      brandProcesses: ["X1", "X2", "X3"].map((id) => bp(id, { operatingRule: "NO_SUNDAY_NO_PH" })),
      assignments: ["X1", "X2", "X3"].map((id) => primary("E", id, 30)),
      leaves: [leave("E", "2026-12-09", "2026-12-10")],
    });
    const { issues } = generateRoster(input);
    const cascades = issuesOf(issues, "CASCADE_GAP");
    expect(cascades.map((c) => c.date)).toEqual(["2026-12-09", "2026-12-10"]);
    for (const c of cascades) {
      expect(c.severity).toBe("ERROR");
      expect(c.employeeId).toBe("E");
      expect([...c.relatedIds!].sort()).toEqual(["X1", "X2", "X3"]);
      for (const name of ["Brand X1", "Brand X2", "Brand X3"]) expect(c.message).toContain(name);
      // it groups the underlying coverage gaps, which are still reported
      expect(c.groupedIssueIds).toHaveLength(3);
      const gapIds = new Set(issuesOf(issues, "COVERAGE_GAP").map((g) => g.id));
      expect(c.groupedIssueIds!.every((g) => gapIds.has(g))).toBe(true);
    }
    expect(issuesOf(issues, "COVERAGE_GAP")).toHaveLength(6);
  });

  it("S09 determinism: same input twice -> deep-equal output", () => {
    const input = seedInput("2026-12");
    const a = generateRoster(input);
    const b = generateRoster(input);
    expect(b).toEqual(a);
    // and independent of the order the input rows arrive in
    const shuffled: EngineInput = {
      ...input,
      employees: [...input.employees].reverse(),
      brandProcesses: [...input.brandProcesses].reverse(),
      assignments: [...input.assignments].reverse(),
      leaves: [...input.leaves].reverse(),
      holidays: [...input.holidays].reverse(),
    };
    expect(generateRoster(shuffled)).toEqual(a);
  });

  it("S10 locked entries preserved across regenerate", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
    });
    const first = generateRoster(input);

    // (a) a manager lock survives, and the rest of the roster re-plans around it
    const locked: DraftEntry = {
      employeeId: "A",
      date: "2026-12-16",
      status: "WEEKLY_OFF",
      coveredBrandProcessIds: [],
      locked: true,
      source: "MANUAL",
    };
    const again = generateRoster(input, { locks: [locked] });
    expect(entry(again.draft, "A", "2026-12-16")).toEqual(locked);
    expect(entry(again.draft, "B", "2026-12-16").status).toBe("WORK"); // B takes the day
    expect(errors(again.issues)).toEqual([]);

    // (b) dates before "today" are history: a new future leave must not rewrite them
    const withLeave: EngineInput = {
      ...input,
      today: "2026-12-10",
      leaves: [leave("B", "2026-12-20", "2026-12-20")],
    };
    const replanned = generateRoster(withLeave, { previous: first.draft });
    for (const d of datesBetween("2026-11-30", "2026-12-09")) {
      expect(entry(replanned.draft, "A", d)).toEqual(entry(first.draft, "A", d));
      expect(entry(replanned.draft, "B", d)).toEqual(entry(first.draft, "B", d));
    }
    expect(entry(replanned.draft, "B", "2026-12-20").status).toBe("LEAVE");
  });

  it("S11 preferred off conflicts with coverage -> coverage wins + PREFERRED_OFF_NOT_HONOURED", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B", { preferredOffDays: ["SAT", "SUN"] })],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
      // Sunday 13 Dec needs two people (a sale day), so B cannot have the preferred Sunday off
      coverageOverrides: [{ brandProcessId: "X", date: "2026-12-13", minStaff: 2 }],
    });
    const { draft, issues } = generateRoster(input);

    expect(entry(draft, "B", "2026-12-13").status).toBe("WORK"); // coverage wins
    expect(coverageOf(input, draft, "X", "2026-12-13")).toBe(2);
    expect(errors(issues)).toEqual([]);
    const warned = issuesOf(issues, "PREFERRED_OFF_NOT_HONOURED").find(
      (i) => i.date === "2026-12-13",
    );
    expect(warned).toBeDefined();
    expect(warned!.severity).toBe("WARNING");
    expect(warned!.employeeId).toBe("B");
    expect(warned!.message).toContain("SUN");
    // the preference is honoured where coverage allows: B's weekly off that week is the preferred Saturday
    expect(offDates(draft, "B")).toContain("2026-12-12");
  });

  it("S12 incompatible shifts across brands -> SHIFT_INCOMPATIBLE", () => {
    const input = makeInput({
      employees: [emp("E"), emp("B")],
      brandProcesses: [
        bp("EARLY", { shiftStart: "06:00", shiftEnd: "15:00" }),
        bp("LATE", { shiftStart: "14:00", shiftEnd: "23:00" }),
      ],
      assignments: [
        primary("E", "EARLY", 50),
        primary("E", "LATE", 50),
        backup("B", "EARLY", 50),
        backup("B", "LATE", 50),
      ],
    });
    const { draft, issues } = generateRoster(input);

    const bad = issuesOf(issues, "SHIFT_INCOMPATIBLE");
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((i) => i.severity === "ERROR" && i.employeeId === "E")).toBe(true);
    expect(bad[0].message).toContain("17");
    // E works both on every day E is working
    const eWork = draft.entries.filter(
      (e) => e.employeeId === "E" && e.status === "WORK" && inDec(e.date),
    );
    expect(bad).toHaveLength(eWork.length);
    // the generator never makes B cover both incompatible brands on the same day
    for (const e of draft.entries.filter((x) => x.employeeId === "B")) {
      expect(e.coveredBrandProcessIds.length).toBeLessThanOrEqual(1);
    }
  });

  it("S13 every suggestion returned, when applied, introduces no new ERROR", () => {
    const check = (input: EngineInput, draft: Parameters<typeof validateRoster>[1]) => {
      const issues = analyzeRoster(input, draft);
      const baseline = new Set(ids(errors(validateRoster(input, draft))));
      let applied = 0;
      for (const issue of issues) {
        for (const s of issue.suggestions) {
          const next = applySuggestion(input, draft, s);
          const after = errors(validateRoster(next.input, next.draft));
          const introduced = after.filter((e) => !baseline.has(e.id));
          expect(
            introduced.map((e) => e.message),
            `${issue.code} ${s.type} ${s.description}`,
          ).toEqual([]);
          applied++;
        }
      }
      return applied;
    };

    // (a) the seeded December baseline (Nimbus Gadgets has real, unresolvable errors)
    const dec = seedInput("2026-12");
    const decGen = generateRoster(dec);
    const n1 = check(dec, decGen.draft);

    // (b) Aarav's pending leave approved: a CASCADE_GAP with a mixed resolution
    const approved: EngineInput = {
      ...dec,
      leaves: dec.leaves.map((l) =>
        l.status === "PENDING" ? { ...l, status: "APPROVED" as const } : l,
      ),
    };
    const cascade = generateRoster(approved);
    expect(issuesOf(cascade.issues, "CASCADE_GAP").length).toBeGreaterThan(0);
    const n2 = check(approved, cascade.draft);

    // (c) the manual-edit scenario from S07
    const small = makeInput({
      employees: [emp("A"), emp("B"), emp("C")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X"), backup("C", "X")],
    });
    const g = generateRoster(small);
    const day = offDates(g.draft, "B").find(
      (d) => inDec(d) && entry(g.draft, "A", d).status === "WORK",
    )!;
    const edited = applyEdits(
      g.draft,
      [{ employeeId: "A", date: day, status: "WEEKLY_OFF", coveredBrandProcessIds: [] }],
      { locked: true, source: "MANUAL" },
    );
    const n3 = check(small, edited);

    // not vacuous: suggestions with real edits were produced and checked in every case
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBeGreaterThan(0);
    expect(n3).toBeGreaterThan(0);
  });

  it("S14 invariant on the full seed for 2 months: generator-reported ERRORs == validator ERRORs", () => {
    const dec = seedInput("2026-12");
    const decGen = generateRoster(dec);
    const jan = seedInput("2027-01", {
      neighbourRosters: [{ month: "2026-12", status: "DRAFT", entries: decGen.draft.entries }],
    });
    const janGen = generateRoster(jan);

    for (const [input, gen] of [
      [dec, decGen],
      [jan, janGen],
    ] as const) {
      const fromValidator = errors(validateRoster(input, gen.draft));
      expect(ids(errors(gen.issues))).toEqual(ids(fromValidator));
      expect(fromValidator.length).toBeGreaterThan(0); // Nimbus Gadgets is deliberately unschedulable
      // and Nimbus Gadgets is the ONLY source of errors in the baseline roster
      const nimbusBps = new Set(
        input.brandProcesses.filter((b) => b.brandName === "Nimbus Gadgets").map((b) => b.id),
      );
      for (const e of fromValidator) {
        const belongs =
          (e.brandProcessId !== undefined && nimbusBps.has(e.brandProcessId)) ||
          e.employeeId === "emp-ananya-reddy";
        expect(belongs, `${e.code}: ${e.message}`).toBe(true);
      }
    }
  });

  it("S15 weekly offs: every employee gets >= weeklyOffsPerWeek in qualifying weeks unless an ERROR explains why", () => {
    const dec = seedInput("2026-12");
    const decGen = generateRoster(dec);
    const jan = seedInput("2027-01", {
      neighbourRosters: [{ month: "2026-12", status: "DRAFT", entries: decGen.draft.entries }],
    });
    const janGen = generateRoster(jan);

    let granted = 0;
    let explained = 0;
    for (const [input, gen] of [
      [dec, decGen],
      [jan, janGen],
    ] as const) {
      const notGranted = new Set(
        issuesOf(gen.issues, "WEEKLY_OFF_NOT_GRANTED").map((i) => `${i.employeeId}|${i.date}`),
      );
      for (const w of weeksOfMonth(input.month).filter((x) => x.requiresWeeklyOff)) {
        for (const e of input.employees.filter((x) => x.isActive)) {
          const availableInMonth = w.days.filter(
            (d) =>
              !input.leaves.some(
                (l) =>
                  l.employeeId === e.id &&
                  l.status === "APPROVED" &&
                  l.fromDate <= d &&
                  d <= l.toDate,
              ),
          );
          if (availableInMonth.length < 4) continue; // too little of the week to require an off
          const offs = gen.draft.entries.filter(
            (x) =>
              x.employeeId === e.id && w.fullWeek.includes(x.date) && x.status === "WEEKLY_OFF",
          ).length;
          if (offs >= e.weeklyOffsPerWeek) {
            granted++;
          } else {
            explained++;
            expect(notGranted.has(`${e.id}|${w.monday}`), `${e.name} week ${w.monday}`).toBe(true);
          }
        }
      }
    }
    expect(granted).toBeGreaterThan(200);
    // only Ananya Reddy (Nimbus Gadgets) may go without, in every qualifying week of both months
    expect(explained).toBeGreaterThan(0);
    const allNotGranted = [
      ...issuesOf(decGen.issues, "WEEKLY_OFF_NOT_GRANTED"),
      ...issuesOf(janGen.issues, "WEEKLY_OFF_NOT_GRANTED"),
    ];
    expect(new Set(allNotGranted.map((i) => i.employeeId))).toEqual(new Set(["emp-ananya-reddy"]));
  });

  it("S16 boundary week: Dec generated first -> Aarav's off lands on 2027-01-03; Jan generated next carries it locked", () => {
    const dec = generateRoster(seedInput("2026-12"));
    const aarav = "emp-aarav-sharma";
    // Aarav's three brands are closed on Sundays, so the only free day of the 28 Dec week is Sun 3 Jan
    expect(offDates(dec.draft, aarav).filter((d) => d >= "2026-12-28")).toEqual(["2027-01-03"]);
    expect(
      issuesOf(dec.issues, "WEEKLY_OFF_NOT_GRANTED").filter((i) => i.employeeId === aarav),
    ).toEqual([]);
    // the Dec draft stores the whole planning window, including the spill dates
    expect(dec.draft.entries.some((e) => e.date === "2027-01-03")).toBe(true);
    expect(dec.draft.entries.some((e) => e.date === "2026-11-30")).toBe(true);

    const janInput = seedInput("2027-01", {
      neighbourRosters: [{ month: "2026-12", status: "DRAFT", entries: dec.draft.entries }],
    });
    const jan = generateRoster(janInput);
    expect(entry(jan.draft, aarav, "2027-01-03")).toMatchObject({
      status: "WEEKLY_OFF",
      locked: true,
      source: "AUTO",
    });
    expect(entry(jan.draft, aarav, "2027-01-03").note).toContain("carried from 2026-12");
    // the carried off survives a regenerate of January too
    const again = generateRoster(janInput);
    expect(entry(again.draft, aarav, "2027-01-03")).toEqual(entry(jan.draft, aarav, "2027-01-03"));
  });

  it("S17 boundary week: Jan generated with no Dec roster -> no weekly-off issue for the Dec-owned week in Jan", () => {
    const jan = generateRoster(seedInput("2027-01"));
    // the week of 28 Dec has only 3 January days, so it is owned by December, not January
    const forDecWeek = issuesOf(jan.issues, "WEEKLY_OFF_NOT_GRANTED").filter(
      (i) => i.date === "2026-12-28",
    );
    expect(forDecWeek).toEqual([]);
    // and January's own weeks still get their offs (only Nimbus Gadgets' Ananya is unresolvable)
    const jan2 = issuesOf(jan.issues, "WEEKLY_OFF_NOT_GRANTED");
    expect(new Set(jan2.map((i) => i.employeeId))).toEqual(new Set(["emp-ananya-reddy"]));
    // spill dates still exist as provisional entries, not locked
    expect(entry(jan.draft, "emp-aarav-sharma", "2026-12-28").locked).toBe(false);
  });

  it("S18 boundary week: neighbour PUBLISHED with WORK on the only free day -> WEEKLY_OFF_NOT_GRANTED naming that date", () => {
    const aarav = "emp-aarav-sharma";
    const work = (date: string): DraftEntry => ({
      employeeId: aarav,
      date,
      status: "WORK",
      coveredBrandProcessIds: [],
      locked: false,
      source: "AUTO",
    });
    const withPublishedJan = (entries: DraftEntry[]) =>
      generateRoster(
        seedInput("2026-12", {
          neighbourRosters: [{ month: "2027-01", status: "PUBLISHED", entries }],
        }),
      );

    // Only Sun 3 Jan is locked WORK: Fri 1 Jan is a public holiday on which all three of Aarav's brands
    // are closed, so it is another free day and the off lands there. No false error.
    const oneLocked = withPublishedJan([work("2027-01-03")]);
    expect(entry(oneLocked.draft, aarav, "2027-01-03")).toMatchObject({
      status: "WORK",
      locked: true,
    });
    expect(entry(oneLocked.draft, aarav, "2027-01-01").status).toBe("WEEKLY_OFF");
    expect(
      issuesOf(oneLocked.issues, "WEEKLY_OFF_NOT_GRANTED").filter((i) => i.employeeId === aarav),
    ).toEqual([]);

    // Both free days are locked WORK in the published January roster: M must not overwrite them.
    const dec = withPublishedJan([work("2027-01-01"), work("2027-01-03")]);
    expect(entry(dec.draft, aarav, "2027-01-03")).toMatchObject({ status: "WORK", locked: true });
    expect(entry(dec.draft, aarav, "2027-01-01")).toMatchObject({ status: "WORK", locked: true });
    const issue = issuesOf(dec.issues, "WEEKLY_OFF_NOT_GRANTED").find(
      (i) => i.employeeId === aarav,
    )!;
    expect(issue).toBeDefined();
    expect(issue.date).toBe("2026-12-28"); // the Dec-owned week
    expect(issue.message).toContain("2027-01-03");
    expect(issue.message).toContain("2027-01-01");
    const swap = issue.suggestions.find(
      (s) => s.type === "SWAP_OFF_DAY" && s.date === "2027-01-03",
    );
    expect(swap, JSON.stringify(issue.suggestions)).toBeDefined();
    expect(swap!.employeeId).toBe(aarav);
    expect(swap!.description).toContain("2027-01");
  });
});
