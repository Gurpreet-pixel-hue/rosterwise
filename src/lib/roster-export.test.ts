import { describe, expect, it } from "vitest";
import type { CoverageTable } from "@/engine/coverage";
import type { DraftEntry, Issue } from "@/engine/types";
import type { RosterRefs } from "@/server/pageData";
import { csvCell, toCsv } from "./csv";
import {
  coverageRows,
  exportFileName,
  gridRows,
  isExportWhat,
  isViewKind,
  issueRows,
} from "./roster-export";

describe("CSV writing", () => {
  it("quotes commas, quotes and newlines (RFC 4180) and ends rows with CRLF", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(
      toCsv([
        ["a", "b"],
        ["1", "2,3"],
      ]),
    ).toBe('a,b\r\n1,"2,3"\r\n');
  });

  it("neutralises spreadsheet formulas in text, but not real numbers", () => {
    for (const evil of ['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)", "\tcmd"]) {
      const out = csvCell(evil);
      expect(out.replaceAll('"', "").startsWith("'")).toBe(true);
    }
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("W (Coastal / CS)")).toBe("W (Coastal / CS)");
  });
});

const refs: RosterRefs = {
  pods: [{ id: "p1", name: "Pod One", leadId: null }],
  employees: [
    { id: "a", name: "Asha", podId: "p1", isActive: true, preferredOffDays: [], fixedOffDays: [] },
    { id: "b", name: "Bela", podId: "p1", isActive: true, preferredOffDays: [], fixedOffDays: [] },
  ],
  brands: [{ id: "x", name: "X", podId: "p1" }],
  brandProcesses: [
    {
      id: "x-cs",
      brandId: "x",
      brandName: "X",
      brandPodId: "p1",
      processCode: "CS",
      operatingRule: "ALL_DAYS",
      defaultMinStaff: 1,
      shiftStart: "09:00",
      shiftEnd: "18:00",
    },
  ],
  assignments: [{ employeeId: "a", brandProcessId: "x-cs", role: "PRIMARY", allocationPct: 100 }],
  holidays: [],
  leaves: [],
};
const E = (
  employeeId: string,
  date: string,
  status: DraftEntry["status"],
  cov: string[] = [],
): DraftEntry => ({
  employeeId,
  date,
  status,
  coveredBrandProcessIds: cov,
  locked: false,
  source: "AUTO",
});
const window = ["2026-12-06", "2026-12-07"];
const entries = [
  E("a", "2026-12-06", "WEEKLY_OFF"),
  E("a", "2026-12-07", "WORK", ["x-cs"]),
  E("b", "2026-12-06", "WORK"),
  E("b", "2026-12-07", "LEAVE"),
];

describe("what is exported", () => {
  it("the grid CSV follows the view: Company has both people, Brand X only its assignee", () => {
    const all = gridRows({ kind: "company", value: "", window, entries, refs });
    expect(all[0]).toEqual(["Employee", "Pod", "2026-12-06 SUN", "2026-12-07 MON"]);
    expect(all.slice(1)).toEqual([
      ["Asha", "Pod One", "O", "W (X / CS)"],
      ["Bela", "Pod One", "W", "L"],
    ]);
    const brand = gridRows({ kind: "brand", value: "x", window, entries, refs });
    expect(brand.slice(1).map((r) => r[0])).toEqual(["Asha"]);
  });

  it("the coverage CSV prints covering/required and a dash when the brand does not operate", () => {
    const coverage: CoverageTable = {
      "x-cs": {
        "2026-12-06": { required: 0, covering: 0, coverers: [] },
        "2026-12-07": { required: 1, covering: 1, coverers: ["a"] },
      },
    };
    expect(
      coverageRows({ kind: "company", value: "", monthDates: window, coverage, refs }),
    ).toEqual([
      ["Brand", "Process", "Shift", "2026-12-06 SUN", "2026-12-07 MON"],
      ["X", "CS", "09:00-18:00", "-", "1/1"],
    ]);
  });

  it("the issues CSV names people and brands, and carries acknowledgements; formulas in messages are neutralised", () => {
    const issues: Array<Issue & { acknowledgement?: { note: string; actor: string } | null }> = [
      {
        id: "1",
        code: "COVERAGE_GAP",
        severity: "ERROR",
        date: "2026-12-07",
        brandProcessId: "x-cs",
        message: "=1+1 has 0 of 1",
        suggestions: [],
        acknowledgement: { note: "ok, accepted", actor: "m" },
      },
      {
        id: "2",
        code: "OVERALLOCATED",
        severity: "WARNING",
        employeeId: "b",
        message: "too much",
        suggestions: [],
      },
    ];
    const rows = issueRows({ issues, refs });
    expect(rows[1]).toEqual([
      "ERROR",
      "COVERAGE_GAP",
      "2026-12-07",
      "",
      "X / CS",
      "=1+1 has 0 of 1",
      "yes",
      "ok, accepted",
    ]);
    const text = toCsv(rows);
    expect(text).toContain("'=1+1 has 0 of 1");
    expect(text).toContain('"ok, accepted"');
    expect(
      issueRows({ issues, refs, kindFilter: { employeeIds: new Set(["b"]), bpIds: new Set() } })
        .length,
    ).toBe(2);
  });

  it("builds safe file names and validates the query values", () => {
    expect(exportFileName("2026-12", "brand", "Nimbus Gadgets", "grid")).toBe(
      "roster-2026-12-brand-nimbus-gadgets-grid.csv",
    );
    expect(exportFileName("2026-12", "company", "", "issues")).toBe(
      "roster-2026-12-company-issues.csv",
    );
    expect(exportFileName("2026-12", "employee", '../"x"\n', "grid")).toBe(
      "roster-2026-12-employee-x-grid.csv",
    );
    expect(isViewKind("pod")).toBe(true);
    expect(isViewKind("hax")).toBe(false);
    expect(isExportWhat("coverage")).toBe(true);
    expect(isExportWhat("../etc")).toBe(false);
  });
});
