// pnpm metrics            measure everything and write docs/METRICS.md
// pnpm metrics --no-tests skip the (slower) full test run
//
// Every number in docs/METRICS.md comes from this script, never from memory or an estimate. It needs no
// database: it builds the demo seed in memory and drives the real engine with it, the same way the tests do.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { buildSeedData, type SeedSnapshot } from "../prisma/seed-data";
import { coverageTable } from "../src/engine/coverage";
import { generateRoster } from "../src/engine/generate";
import { ISSUE_SEVERITY, type EngineInput, type Issue, type IssueCode } from "../src/engine/types";
import { buildEngineInput, type EngineRows } from "../src/server/buildEngineInput";
import { singleResourcePct } from "./seed-checks";

const MONTHS = ["2026-12", "2027-01"] as const;
const RUNS = 10;
const previousMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** Input for a month with the previous month generated in memory, as `pnpm roster:dry-run` does. */
function chainedInput(rows: EngineRows, month: string): EngineInput {
  const prev = generateRoster(buildEngineInput(rows, previousMonth(month)), { suggestions: false });
  return buildEngineInput(rows, month, {
    neighbourRosters: [
      { month: previousMonth(month), status: "DRAFT", entries: prev.draft.entries },
    ],
  });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function timeMs(fn: () => unknown, runs = RUNS): { median: number; min: number; max: number } {
  fn(); // one warm-up run, discarded (JIT, module caches)
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return { median: median(times), min: Math.min(...times), max: Math.max(...times) };
}

/** n copies of the seed organisation (own pods, people, brands, leaves), sharing one calendar and process catalog. */
function scaled(seed: SeedSnapshot, copies: number): SeedSnapshot {
  if (copies === 1) return seed;
  const out: SeedSnapshot = {
    ...seed,
    pods: [],
    employees: [],
    brands: [],
    brandProcesses: [],
    assignments: [],
    leaves: [],
    coverageOverrides: [],
  };
  for (let c = 0; c < copies; c++) {
    const s = (id: string) => (c === 0 ? id : `${id}~${c + 1}`);
    out.pods.push(...seed.pods.map((p) => ({ ...p, id: s(p.id), leadId: s(p.leadId) })));
    out.employees.push(
      ...seed.employees.map((e) => ({
        ...e,
        id: s(e.id),
        podId: s(e.podId),
        name: c === 0 ? e.name : `${e.name} (${c + 1})`,
      })),
    );
    out.brands.push(...seed.brands.map((b) => ({ ...b, id: s(b.id), podId: s(b.podId) })));
    out.brandProcesses.push(
      ...seed.brandProcesses.map((bp) => ({ ...bp, id: s(bp.id), brandId: s(bp.brandId) })),
    );
    out.assignments.push(
      ...seed.assignments.map((a) => ({
        ...a,
        id: s(a.id),
        employeeId: s(a.employeeId),
        brandProcessId: s(a.brandProcessId),
      })),
    );
    out.leaves.push(
      ...seed.leaves.map((l) => ({ ...l, id: s(l.id), employeeId: s(l.employeeId) })),
    );
    out.coverageOverrides.push(
      ...seed.coverageOverrides.map((o) => ({
        ...o,
        id: s(o.id),
        brandProcessId: s(o.brandProcessId),
      })),
    );
  }
  return out;
}

interface DemandStats {
  demandDays: number;
  covered: number;
  errors: number;
  issues: Issue[];
}

/** Generate each demo month and count demand-days (a brand-process on a day it must be staffed) that are fully covered. */
function demandCoverage(rows: EngineRows): DemandStats {
  const stats: DemandStats = { demandDays: 0, covered: 0, errors: 0, issues: [] };
  for (const month of MONTHS) {
    const input = chainedInput(rows, month);
    const { draft, issues } = generateRoster(input, { suggestions: false });
    for (const row of Object.values(coverageTable(input, draft)))
      for (const cell of Object.values(row))
        if (cell.required > 0) {
          stats.demandDays++;
          if (cell.covering >= cell.required) stats.covered++;
        }
    stats.errors += issues.filter((i) => i.severity === "ERROR").length;
    stats.issues.push(...issues);
  }
  return stats;
}

function testRun(): {
  files: number;
  total: number;
  passed: number;
  skipped: number;
  failed: number;
  scenarios: number;
} {
  const dir = mkdtempSync(join(tmpdir(), "rosterwise-metrics-"));
  const out = join(dir, "vitest.json");
  try {
    execFileSync("pnpm", ["exec", "vitest", "run", "--reporter=json", `--outputFile=${out}`], {
      stdio: "pipe",
    });
  } catch {
    // a failing run still writes the JSON; the counts below say so
  }
  const j = JSON.parse(readFileSync(out, "utf8")) as {
    numTotalTests: number;
    numPassedTests: number;
    numPendingTests: number;
    numFailedTests: number;
    testResults: Array<{ assertionResults: Array<{ title: string; fullName?: string }> }>;
  };
  const scenarios = j.testResults
    .flatMap((f) => f.assertionResults)
    .filter((t) => /^S\d{2}[a-z]?\b/.test(t.title)).length;
  return {
    files: j.testResults.length,
    total: j.numTotalTests,
    passed: j.numPassedTests,
    skipped: j.numPendingTests,
    failed: j.numFailedTests,
    scenarios,
  };
}

function codesReferencedByTests(): Set<IssueCode> {
  const files = ["src/engine/__tests__", "src/server/__tests__"].flatMap((d) =>
    readdirSync(d)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(join(d, f), "utf8")),
  );
  const blob = files.join("\n");
  return new Set((Object.keys(ISSUE_SEVERITY) as IssueCode[]).filter((c) => blob.includes(c)));
}

const fmt = (ms: number) => (ms >= 100 ? `${ms.toFixed(0)} ms` : `${ms.toFixed(1)} ms`);
const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;

function main() {
  const seed = buildSeedData();
  const rows = seed as unknown as EngineRows;
  const lines: string[] = [];
  const add = (s = "") => lines.push(s);

  // --- seed size
  const active = seed.employees.filter((e) => e.isActive).length;
  const primaryBps = new Set(
    seed.assignments.filter((a) => a.role === "PRIMARY").map((a) => a.brandProcessId),
  ).size;
  const sizes = {
    employees: active,
    pods: seed.pods.length,
    brands: seed.brands.length,
    brandProcesses: seed.brandProcesses.length,
    assignments: seed.assignments.length,
    backups: seed.assignments.filter((a) => a.role === "BACKUP").length,
    singlePct: singleResourcePct(seed),
  };

  // --- determinism
  const probe = chainedInput(rows, MONTHS[0]);
  const a = generateRoster(probe);
  const b = generateRoster(probe);
  const deterministic = JSON.stringify(a) === JSON.stringify(b);

  // --- timing
  const input1 = chainedInput(rows, MONTHS[0]);
  const withSuggestions = timeMs(() => generateRoster(input1));
  const noSuggestions = timeMs(() => generateRoster(input1, { suggestions: false }));
  const scaleRows = [1, 2, 4].map((n) => {
    const s = scaled(seed, n);
    const input = chainedInput(s as unknown as EngineRows, MONTHS[0]);
    const t = timeMs(() => generateRoster(input, { suggestions: false }), n === 4 ? 5 : RUNS);
    const full = timeMs(() => generateRoster(input), n === 4 ? 3 : 5);
    return {
      n,
      employees: s.employees.length,
      brandProcesses: s.brandProcesses.length,
      cells: generateRoster(input, { suggestions: false }).draft.entries.length,
      gen: t.median,
      withSugg: full.median,
    };
  });

  // --- coverage with and without backups
  const withBackups = demandCoverage(rows);
  const noBackupRows = {
    ...rows,
    assignments: rows.assignments.filter((x) => x.role !== "BACKUP"),
  };
  const withoutBackups = demandCoverage(noBackupRows);

  // --- issue codes
  const allCodes = Object.keys(ISSUE_SEVERITY) as IssueCode[];
  const observed = new Set(withBackups.issues.map((i) => i.code));
  const inTests = codesReferencedByTests();

  // --- tests
  const tests = process.argv.includes("--no-tests") ? null : testRun();

  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "prisma", "scripts"])
    .toString()
    .trim()
    ? " (+ uncommitted changes)"
    : "";

  add("# Metrics");
  add();
  add(`<!-- Generated by \`pnpm metrics\`. Do not edit by hand: re-run the script. -->`);
  add();
  add(
    `Measured by \`scripts/metrics.ts\` on ${new Date().toISOString().slice(0, 10)}, commit \`${commit}\`${dirty}.`,
  );
  add(
    `Machine: ${cpus()[0].model}, ${cpus().length} cores, Node ${process.version}. Timings are wall-clock on this machine and vary on others.`,
  );
  add();
  add("## Seed data (what the demo runs on)");
  add();
  add("| Metric | Value |");
  add("|---|---|");
  add(`| Active employees | ${sizes.employees} |`);
  add(`| Pods | ${sizes.pods} |`);
  add(`| Brands | ${sizes.brands} |`);
  add(`| Brand-processes (the demand units) | ${sizes.brandProcesses} |`);
  add(`| Assignments (PRIMARY + BACKUP) | ${sizes.assignments} (${sizes.backups} BACKUP) |`);
  add(
    `| Single-resource brands | ${sizes.singlePct.toFixed(1)}% (one PRIMARY covers the whole brand) |`,
  );
  add(`| Brand-processes with a PRIMARY | ${primaryBps} of ${sizes.brandProcesses} |`);
  add();
  add("## Tests");
  add();
  if (tests) {
    add("| Metric | Value |");
    add("|---|---|");
    add(`| Test files | ${tests.files} |`);
    add(
      `| Tests | ${tests.total} total: ${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped |`,
    );
    add(`| Named scenario tests (\`S01\` to \`S20\`, including \`S19b\`) | ${tests.scenarios} |`);
    add();
    if (tests.skipped > 0)
      add(
        `> ${tests.skipped} tests were skipped, which means \`TEST_DATABASE_URL\` was not set for this run. CI runs them against a real Postgres.`,
      );
    if (tests.failed > 0)
      add(
        `> **${tests.failed} tests failed in this run.** Fix them before quoting any number here.`,
      );
  } else add("_Skipped (`--no-tests`)._");
  add();
  add("## Engine");
  add();
  add(
    `Deterministic: ${deterministic ? "yes, two generations of the same input are identical (deep-equal)" : "**NO: two generations differed**"}.`,
  );
  add();
  add(
    `### Generation time, one month (${MONTHS[0]}, ${sizes.employees} employees, ${sizes.brandProcesses} brand-processes)`,
  );
  add();
  add(
    `Median of ${RUNS} runs after one discarded warm-up. The previous month is generated in memory first for the boundary week, and not timed.`,
  );
  add();
  add("| Run | Median | Min | Max |");
  add("|---|---|---|---|");
  add(
    `| Generate + validate + ranked suggestions (what the Generate button runs) | ${fmt(withSuggestions.median)} | ${fmt(withSuggestions.min)} | ${fmt(withSuggestions.max)} |`,
  );
  add(
    `| Generate + validate, no suggestions | ${fmt(noSuggestions.median)} | ${fmt(noSuggestions.min)} | ${fmt(noSuggestions.max)} |`,
  );
  add();
  add("### Scaling: synthetic copies of the whole organisation");
  add();
  add(
    "Each copy adds its own pods, people, brands, assignments and leaves, and shares the calendar and process catalog. Median of 10 runs (1x, 2x), 5 runs (4x); with suggestions, median of 5 (3 at 4x). Engine only, no database or network.",
  );
  add();
  add(
    "| Scale | Employees | Brand-processes | Roster cells | Generate + validate | Same, with suggestions | vs 1x (no suggestions) |",
  );
  add("|---|---|---|---|---|---|---|");
  for (const r of scaleRows)
    add(
      `| ${r.n}x | ${r.employees} | ${r.brandProcesses} | ${r.cells} | ${fmt(r.gen)} | ${fmt(r.withSugg)} | ${(r.gen / scaleRows[0].gen).toFixed(1)}x |`,
    );
  add();
  add("## Coverage of the seeded demand");
  add();
  add(
    `A demand-day is one brand-process on one day it must be staffed (operating rule, holidays, weekday minimums and overrides applied), over ${MONTHS.join(" and ")}. It is covered when at least the required number of people work it. The roster is the engine's own output; nothing is edited by hand.`,
  );
  add();
  add("| Scenario | Demand-days | Covered | ERROR issues |");
  add("|---|---|---|---|");
  add(
    `| With backups (as seeded) | ${withBackups.demandDays} | ${withBackups.covered} (${pct(withBackups.covered, withBackups.demandDays)}) | ${withBackups.errors} |`,
  );
  add(
    `| Without backups (all ${sizes.backups} BACKUP assignments removed, regenerated) | ${withoutBackups.demandDays} | ${withoutBackups.covered} (${pct(withoutBackups.covered, withoutBackups.demandDays)}) | ${withoutBackups.errors} |`,
  );
  add();
  const errorsByCode = (st: DemandStats) => {
    const m = new Map<string, number>();
    for (const x of st.issues) if (x.severity === "ERROR") m.set(x.code, (m.get(x.code) ?? 0) + 1);
    return m;
  };
  const eWith = errorsByCode(withBackups);
  const eWithout = errorsByCode(withoutBackups);
  const errCodes = [...new Set([...eWith.keys(), ...eWithout.keys()])];
  add(
    "ERROR issues by code. Coverage alone can flatter: the engine keeps a person working rather than open a coverage gap, and then reports the missing weekly off as an ERROR.",
  );
  add();
  add("| ERROR code | With backups | Without backups |");
  add("|---|---|---|");
  for (const c of errCodes) add(`| \`${c}\` | ${eWith.get(c) ?? 0} | ${eWithout.get(c) ?? 0} |`);
  add();
  add(
    `Removing the backups leaves ${withBackups.covered - withoutBackups.covered} more demand-days short and raises the ERROR count from ${withBackups.errors} to ${withoutBackups.errors}.`,
  );
  add();
  add("## Issue codes");
  add();
  add(
    `The validator defines ${allCodes.length} issue codes (${allCodes.filter((c) => ISSUE_SEVERITY[c] === "ERROR").length} ERROR, ${allCodes.filter((c) => ISSUE_SEVERITY[c] === "WARNING").length} WARNING, ${allCodes.filter((c) => ISSUE_SEVERITY[c] === "INFO").length} INFO).`,
  );
  add(
    `${observed.size} of ${allCodes.length} appear on the baseline seed rosters; ${inTests.size} of ${allCodes.length} are referenced by name in the engine or server tests.`,
  );
  add();
  add("| Code | Severity | On the baseline seed | Named in tests |");
  add("|---|---|---|---|");
  for (const c of allCodes)
    add(
      `| \`${c}\` | ${ISSUE_SEVERITY[c]} | ${withBackups.issues.filter((i) => i.code === c).length || "-"} | ${inTests.has(c) ? "yes" : "no"} |`,
    );
  add();
  add(
    "Codes that do not appear on the baseline appear when the demo changes something (a manual edit, a what-if leave, a rule change). That is by design: the baseline is built to fail only where the demo scenarios say.",
  );
  add();

  const md = lines.join("\n");
  writeFileSync("docs/METRICS.md", md);
  console.log(md);
}

main();
