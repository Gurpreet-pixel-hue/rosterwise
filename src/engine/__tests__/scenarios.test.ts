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
import { coverageShortfalls, hasPlainFreeDay, missingWeeklyOffs } from "./oracle";
import { seedInput } from "./seedInput";

const DEC = monthDates("2026-12");

/**
 * Holiday-hosted weekly offs that are unavoidable (ASSUMPTIONS 24). All five are Sun 6 Dec, a public
 * holiday on a Sunday:
 *  - Aarav, Kabir, Priya, Gaurav: sole cover for a brand closed on Sundays and with no backup
 *    (Lumen/Verdant, Orchid Home, Indigo Denim, Pixel Pets), so Mon-Sat are all needed and the
 *    Sunday holiday is the only free day. (Kabir's contract-fixed Sunday is also the holiday.)
 *  - Siddharth: his contract-fixed Sunday off lands on the holiday, but other days are free, so he also gets a real off on 1 Dec,
 *    so he does not lose the holiday.
 */
const EXPECTED_HOSTED: string[] = [
  "emp-aarav-sharma@2026-12-06",
  "emp-gaurav-chopra@2026-12-06",
  "emp-kabir-singh@2026-12-06",
  "emp-priya-nair@2026-12-06",
  "emp-siddharth-jain@2026-12-06",
];
/**
 * Employees whose over-limit run genuinely cannot be repaired, by name, with the reason (S20).
 * Arjun Nambiar, 19-25 Jan 2027: Orbit Electronics (3 people sharing a minimum of 2, so at most one is
 * off a day) around the 26 Jan holiday, which still needs 2 working. Moving his own off only trades one
 * 7-day run for another, 25 Jan is Pooja's off, and rotating all three pushes Sneha (sick on 20 Jan)
 * over her limit. Fixing it needs re-planning the three together across several weeks.
 */
const UNREPAIRABLE: string[] = ["emp-arjun-nambiar"];
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

    // ---- independent oracle (review finding 3): not RosterState, not ctx, not validate ----------
    for (const [input, gen] of [
      [dec, decGen],
      [jan, janGen],
    ] as const) {
      const short = coverageShortfalls(input, gen.draft);
      const gaps = issuesOf(gen.issues, "COVERAGE_GAP");
      const noStaff = issuesOf(gen.issues, "NO_ELIGIBLE_STAFF");
      // (a) every shortfall the oracle finds is reported ...
      for (const s of short) {
        const reported = s.noAssignees
          ? noStaff.some((i) => i.brandProcessId === s.bpId)
          : gaps.some((i) => i.brandProcessId === s.bpId && i.date === s.date);
        expect(reported, `oracle shortfall ${s.bpId} ${s.date} not reported`).toBe(true);
      }
      // (b) ... and every reported gap is a real shortfall, with the same numbers
      for (const g of gaps) {
        const o = short.find((s) => s.bpId === g.brandProcessId && s.date === g.date);
        expect(o, `reported gap ${g.message} is not a shortfall`).toBeDefined();
        expect(g.message).toContain(`has ${o!.covering} of ${o!.required}`);
      }
      // (c) outside Nimbus Gadgets there is no coverage shortfall at all
      const nimbus = new Set(
        input.brandProcesses.filter((b) => b.brandName === "Nimbus Gadgets").map((b) => b.id),
      );
      expect(short.filter((s) => !nimbus.has(s.bpId))).toEqual([]);

      // weekly offs, with the holiday rule applied: oracle's missing set == reported WEEKLY_OFF_NOT_GRANTED
      const reported = new Set(
        issuesOf(gen.issues, "WEEKLY_OFF_NOT_GRANTED").map((i) => `${i.employeeId}|${i.date}`),
      );
      expect([...missingWeeklyOffs(input, gen.draft)].sort()).toEqual([...reported].sort());
    }

    // The oracle is not vacuous: break a roster by hand and it, and the validator, both notice.
    const broken = applyEdits(
      decGen.draft,
      [
        {
          employeeId: "emp-ishita-verma",
          date: "2026-12-16",
          status: "WEEKLY_OFF",
          coveredBrandProcessIds: [],
        },
        {
          employeeId: "emp-divya-menon",
          date: "2026-12-16",
          status: "WEEKLY_OFF",
          coveredBrandProcessIds: [],
        },
      ],
      { locked: true, source: "MANUAL" },
    );
    const oracle = coverageShortfalls(dec, broken).filter((s) => s.date === "2026-12-16");
    const validator = issuesOf(validateRoster(dec, broken), "COVERAGE_GAP").filter(
      (i) => i.date === "2026-12-16",
    );
    expect(oracle.length).toBeGreaterThanOrEqual(2); // Coastal Candles CS and ACC
    expect(validator.map((i) => i.brandProcessId).sort()).toEqual(oracle.map((s) => s.bpId).sort());
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

  it("S19 holiday hosts a weekly off only when no other day is free (Gaurav: off on 2027-01-03, H on 2027-01-01; Aarav 2026-12-06 still allowed)", () => {
    const dec = seedInput("2026-12");
    const decGen = generateRoster(dec, { suggestions: false });
    const jan = seedInput("2027-01", {
      neighbourRosters: [{ month: "2026-12", status: "DRAFT", entries: decGen.draft.entries }],
    });
    const janGen = generateRoster(jan, { suggestions: false });
    const gaurav = "emp-gaurav-chopra";
    const aarav = "emp-aarav-sharma";

    // Gaurav: Sun 3 Jan was free (Terra Organics is covered by backup Farhan), so the off goes there
    // and New Year's Day stays a holiday. He used to lose the holiday.
    expect(entry(decGen.draft, gaurav, "2027-01-03").status).toBe("WEEKLY_OFF");
    expect(entry(decGen.draft, gaurav, "2027-01-01").status).toBe("HOLIDAY");
    expect(entry(janGen.draft, gaurav, "2027-01-03")).toMatchObject({
      status: "WEEKLY_OFF",
      locked: true,
    });
    expect(entry(janGen.draft, gaurav, "2027-01-01").status).toBe("HOLIDAY");

    // Aarav, 6 Dec: every other day of that week is needed (three Sunday-closed brands, two without a
    // backup), so the Sunday holiday legitimately hosts the off, and nothing is reported.
    expect(entry(decGen.draft, aarav, "2026-12-06").status).toBe("WEEKLY_OFF");
    expect(
      issuesOf(decGen.issues, "WEEKLY_OFF_NOT_GRANTED").filter((i) => i.employeeId === aarav),
    ).toEqual([]);

    // Across both months, every holiday-hosted off is one the independent oracle agrees was unavoidable.
    const hosted: string[] = [];
    for (const [input, gen] of [
      [dec, decGen],
      [jan, janGen],
    ] as const) {
      const ph = new Map(input.holidays.map((h) => [h.date, h.name]));
      for (const e of gen.draft.entries.filter(
        (x) => x.status === "WEEKLY_OFF" && ph.has(x.date),
      )) {
        const week = weeksOfMonth(input.month).find((w) => w.fullWeek.includes(e.date))!;
        // Either the employee also got a real off that week (Siddharth: his fixed Sunday is the holiday,
        // plus an off on 1 Dec), or the independent oracle agrees no other day was free (the rest,
        // including Kabir, whose fixed Sunday is also the holiday but who is sole cover Mon-Sat).
        const alsoHasPlainOff = gen.draft.entries.some(
          (x) =>
            x.employeeId === e.employeeId &&
            x.status === "WEEKLY_OFF" &&
            week.fullWeek.includes(x.date) &&
            !ph.has(x.date),
        );
        expect(
          alsoHasPlainOff || !hasPlainFreeDay(input, gen.draft, e.employeeId, week.fullWeek),
          `${e.employeeId} off on ${e.date} (${ph.get(e.date)}) although another day was free`,
        ).toBe(true);
        hosted.push(`${e.employeeId}@${e.date}`);
      }
    }
    // the carried 1 Jan entries are not counted twice: de-duplicate across the two drafts
    expect([...new Set(hosted)].sort()).toEqual(EXPECTED_HOSTED);
    // the validator reports no avoidable one in either month except Ananya's (Nimbus Gadgets) missing offs
    for (const gen of [decGen, janGen]) {
      expect(
        new Set(issuesOf(gen.issues, "WEEKLY_OFF_NOT_GRANTED").map((i) => i.employeeId)),
      ).toEqual(new Set(["emp-ananya-reddy"]));
    }
  });

  it("S19b validator-only: an avoidable weekly off on a public holiday is WEEKLY_OFF_NOT_GRANTED, naming the holiday and the free day", () => {
    const input = makeInput({
      employees: [emp("A"), emp("B")],
      brandProcesses: [bp("X")],
      assignments: [primary("A", "X"), backup("B", "X")],
      holidays: [{ date: "2026-12-25", name: "Christmas Day" }],
    });
    const { draft } = generateRoster(input, { suggestions: false });
    const week = weeksOfMonth("2026-12").find((w) => w.fullWeek.includes("2026-12-25"))!;
    const plainOff = week.fullWeek.find((d) => entry(draft, "A", d).status === "WEEKLY_OFF")!;
    expect(plainOff).toBeDefined();
    expect(plainOff).not.toBe("2026-12-25");
    expect(issuesOf(validateRoster(input, draft), "WEEKLY_OFF_NOT_GRANTED")).toEqual([]);

    // a manager moves A's off onto Christmas Day by hand (and B covers), although other days were free
    const edited = applyEdits(
      draft,
      [
        { employeeId: "A", date: plainOff, status: "WORK", coveredBrandProcessIds: ["X"] },
        { employeeId: "A", date: "2026-12-25", status: "WEEKLY_OFF", coveredBrandProcessIds: [] },
        { employeeId: "B", date: "2026-12-25", status: "WORK", coveredBrandProcessIds: ["X"] },
      ],
      { locked: true, source: "MANUAL" },
    );
    const found = issuesOf(validateRoster(input, edited), "WEEKLY_OFF_NOT_GRANTED");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "ERROR", employeeId: "A", date: week.monday });
    expect(found[0].message).toContain("public holiday");
    expect(found[0].message).toContain("Christmas Day");
    expect(found[0].message).toContain("2026-12-25");
    expect(found[0].message).toMatch(/although .*20\d\d-12-\d\d.* (was|were) free/);
    // nothing else is wrong with that roster: coverage still holds
    expect(issuesOf(validateRoster(input, edited), "COVERAGE_GAP")).toEqual([]);
  });

  it("S20 repair pass: no avoidable CONSECUTIVE_DAYS_EXCEEDED on the seed", () => {
    const dec = seedInput("2026-12");
    const decGen = generateRoster(dec, { suggestions: false });
    const jan = seedInput("2027-01", {
      neighbourRosters: [{ month: "2026-12", status: "DRAFT", entries: decGen.draft.entries }],
    });
    const janGen = generateRoster(jan, { suggestions: false });
    for (const gen of [decGen, janGen]) {
      const owners = issuesOf(gen.issues, "CONSECUTIVE_DAYS_EXCEEDED").map((i) => i.employeeId);
      // Ananya Reddy (Nimbus Gadgets, no backup, no weekly off possible) is the only allowed owner,
      // plus anything on the by-name allowlist below with its reason.
      expect(owners.filter((o) => o !== "emp-ananya-reddy" && !UNREPAIRABLE.includes(o!))).toEqual(
        [],
      );
    }
    // the repair never trades coverage for it: there are still no coverage errors outside Nimbus
    for (const gen of [decGen, janGen]) expect(issuesOf(gen.issues, "COVERAGE_GAP")).toEqual([]);
  });
});
