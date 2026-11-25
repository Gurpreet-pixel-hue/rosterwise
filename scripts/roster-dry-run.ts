// pnpm roster:dry-run 2026-12
// Generates a month from the database with the real engine, WITHOUT saving anything, and prints a
// compact text grid, per brand-process coverage and an issue summary, so a month can be hand-checked.
//
// The previous month is generated in memory first (unless --no-chain) so a weekly off that sits in
// this month's first days, serving last month's boundary week, is carried in as a locked entry.
import { PrismaClient } from "@prisma/client";
import { isOperating, weekdayOf, weeksOfMonth } from "../src/engine/calendar";
import { generateRoster } from "../src/engine/generate";
import type { EngineInput, EntryStatus, Issue, RosterDraft } from "../src/engine/types";
import { loadEngineInput } from "../src/server/loadEngineInput";

const CODE: Record<EntryStatus, string> = {
  WORK: "W",
  WEEKLY_OFF: "O",
  LEAVE: "L",
  COMP_OFF: "C",
  HOLIDAY: "H",
  UNAVAILABLE: "U",
};

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function printGrid(input: EngineInput, draft: RosterDraft) {
  const window = weeksOfMonth(input.month).flatMap((w) => w.fullWeek);
  const inMonth = new Set(weeksOfMonth(input.month).flatMap((w) => w.days));
  const nameW = 26;

  const header = (f: (d: string) => string) =>
    " ".repeat(nameW + 1) +
    window
      .map((d, i) => (i > 0 && !inMonth.has(d) !== !inMonth.has(window[i - 1]) ? "|" : "") + f(d))
      .join("");
  console.log(header((d) => d.slice(8, 9)));
  console.log(header((d) => d.slice(9, 10)));
  console.log(header((d) => weekdayOf(d)[0]));

  const byPod = new Map<string, typeof input.employees>();
  for (const e of input.employees.filter((x) => x.isActive)) {
    byPod.set(e.podId, [...(byPod.get(e.podId) ?? []), e]);
  }
  for (const [pod, emps] of [...byPod].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    console.log(`-- ${pod}`);
    for (const e of emps.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const row = window
        .map((d, i) => {
          const entry = draft.entries.find((x) => x.employeeId === e.id && x.date === d);
          let ch = entry ? CODE[entry.status] : "?";
          // a working person who covers nothing (bench / backup pool, or a closed day) is lower case
          if (entry && entry.status === "WORK" && entry.coveredBrandProcessIds.length === 0)
            ch = "w";
          if (entry?.locked) ch = ch.toLowerCase() === "o" ? "Ō" : ch;
          return (i > 0 && !inMonth.has(d) !== !inMonth.has(window[i - 1]) ? "|" : "") + ch;
        })
        .join("");
      console.log(`${e.name.slice(0, nameW).padEnd(nameW)} ${row}`);
    }
  }
}

function printCoverage(input: EngineInput, draft: RosterDraft) {
  const window = weeksOfMonth(input.month).flatMap((w) => w.fullWeek);
  const inMonth = new Set(weeksOfMonth(input.month).flatMap((w) => w.days));
  const assigned = new Map<string, Set<string>>();
  for (const a of input.assignments) {
    assigned.set(a.brandProcessId, (assigned.get(a.brandProcessId) ?? new Set()).add(a.employeeId));
  }
  const labelW = 34;
  console.log(
    `\nCoverage per brand-process (digit = people covering, '.' = not operating, '!' = short)`,
  );
  for (const bp of [...input.brandProcesses].sort((a, b) =>
    a.brandName + a.processCode < b.brandName + b.processCode ? -1 : 1,
  )) {
    let line = "";
    window.forEach((d, i) => {
      const covering = draft.entries.filter(
        (e) =>
          e.date === d &&
          e.status === "WORK" &&
          assigned.get(bp.id)?.has(e.employeeId) &&
          e.coveredBrandProcessIds.includes(bp.id),
      ).length;
      const sep = i > 0 && !inMonth.has(d) !== !inMonth.has(window[i - 1]) ? "|" : "";
      line +=
        sep + (covering === 0 && !operating(input, bp.id, d) ? "." : String(Math.min(covering, 9)));
    });
    console.log(
      `${`${bp.brandName} / ${bp.processCode}`.slice(0, labelW).padEnd(labelW)} ${rule(bp.operatingRule).padEnd(3)} ${line}`,
    );
  }
}

const rule = (r: string) =>
  ({ ALL_DAYS: "365", NO_PUBLIC_HOLIDAYS: "NPH", NO_SUNDAY_NO_PH: "NSP", CUSTOM: "CUS" })[r] ?? r;

// Only drives the '.' marker in the coverage view.
function operating(input: EngineInput, bpId: string, date: string): boolean {
  const bp = input.brandProcesses.find((b) => b.id === bpId)!;
  return isOperating(bp, date, new Set(input.holidays.map((h) => h.date)));
}

function printIssues(issues: Issue[]) {
  const byCode = new Map<string, number>();
  for (const i of issues)
    byCode.set(`${i.severity} ${i.code}`, (byCode.get(`${i.severity} ${i.code}`) ?? 0) + 1);
  console.log(`\nIssues: ${issues.length} total`);
  for (const [k, n] of [...byCode].sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
  const errors = issues.filter((i) => i.severity === "ERROR");
  if (errors.length > 0) {
    console.log(`\nERRORs (${errors.length}):`);
    for (const e of errors.slice(0, 25)) {
      console.log(`  [${e.code}] ${e.message}`);
      const s = e.suggestions.find((x) => x.type !== "ACCEPT_GAP");
      if (s) console.log(`      -> ${s.type}: ${s.description}`);
    }
    if (errors.length > 25) console.log(`  ... and ${errors.length - 25} more`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const month = args.find((a) => /^\d{4}-\d{2}$/.test(a));
  if (!month) {
    console.error("usage: pnpm roster:dry-run YYYY-MM [--no-chain]");
    process.exit(2);
  }
  const chain = !args.includes("--no-chain");
  const prisma = new PrismaClient();
  try {
    let input = await loadEngineInput(prisma, month);
    let chained = "";
    if (chain && !(input.neighbourRosters ?? []).some((n) => n.month === previousMonth(month))) {
      const prevInput = await loadEngineInput(prisma, previousMonth(month));
      const prev = generateRoster(prevInput, { suggestions: false });
      input = {
        ...input,
        neighbourRosters: [
          ...(input.neighbourRosters ?? []),
          { month: previousMonth(month), status: "DRAFT", entries: prev.draft.entries },
        ],
      };
      chained = ` (previous month ${previousMonth(month)} generated in memory for boundary-week carry-over)`;
    }

    const t0 = process.hrtime.bigint();
    const { draft, issues } = generateRoster(input);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    console.log(`\nRoster dry-run ${month}${chained}`);
    console.log(
      `${input.employees.filter((e) => e.isActive).length} employees, ${input.brandProcesses.length} brand-processes, ` +
        `${draft.entries.length} cells, generated + validated + suggestions in ${ms.toFixed(0)} ms. Nothing was saved.`,
    );
    console.log(
      `Legend: W work, w works but covers nothing (backup pool / closed day), O weekly off, Ō locked weekly off, L leave, C comp-off, H holiday. '|' marks the month boundary (dates outside it are spill).\n`,
    );
    printGrid(input, draft);
    printCoverage(input, draft);
    printIssues(issues);
    console.log(`\nComp-off credits earned this month: ${draft.compOffEarned.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
