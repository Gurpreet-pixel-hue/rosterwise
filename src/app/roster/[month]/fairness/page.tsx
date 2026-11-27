import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { notFound } from "next/navigation";
import type { Spread } from "@/engine/fairness";
import { isMonth } from "@/lib/config";
import { monthTitle } from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import { prisma } from "@/server/db";
import { loadRosterPage } from "@/server/pageData";
import { fairnessForRoster } from "@/server/services/roster";

export const dynamic = "force-dynamic";

function SpreadCard({
  title,
  hint,
  s,
  names,
}: {
  title: string;
  hint: string;
  s: Spread;
  names: Map<string, string>;
}) {
  const list = (ids: string[]) =>
    ids.length === 0
      ? "nobody"
      : ids.length > 3
        ? `${ids.length} people`
        : ids.map((i) => names.get(i) ?? i).join(", ");
  return (
    <div className="px-3.5 py-3">
      <dt className="text-xs text-muted-foreground">{title}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
        {s.min} to {s.max}
        <span
          className={cn(
            "ml-2 font-sans text-xs font-normal",
            s.difference === 0 ? "text-emerald-700" : "text-muted-foreground",
          )}
        >
          spread {s.difference}
        </span>
      </dd>
      <dd className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {hint} Most: {list(s.mostEmployeeIds)}. Least: {list(s.leastEmployeeIds)}. Compared over{" "}
        {s.eligibleCount} people.
      </dd>
    </div>
  );
}

export default async function FairnessPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!isMonth(month)) notFound();
  const data = await loadRosterPage(prisma, month);
  if (!data.view) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-8">
        <h1 className="text-lg font-semibold">Fairness</h1>
        <p className="text-muted-foreground">Generate the {monthTitle(month)} roster first.</p>
        <Link className="underline" href={`/roster/${month}`}>
          Go to the roster
        </Link>
      </div>
    );
  }
  const report = await fairnessForRoster(prisma, data.view.roster.id);
  const names = new Map(data.refs.employees.map((e) => [e.id, e.name]));
  const pods = new Map(data.refs.pods.map((p) => [p.id, p.name]));
  const eligible = report.rows.filter((r) => r.sundayEligible || r.holidayEligible);
  const structural = report.rows.length - eligible.length;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/roster/${month}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {monthTitle(month)} roster
        </Link>
        <span className="text-border">/</span>
        <h1 className="text-lg font-semibold tracking-tight">Weekly-off fairness</h1>
        <span className="font-mono text-xs text-muted-foreground">
          version {data.view.roster.version} ({data.view.roster.status.toLowerCase()})
        </span>
        <a
          href={`/roster/${month}/export?what=fairness&kind=company`}
          download
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium hover:bg-muted"
        >
          <Download className="size-3.5 text-muted-foreground" /> Export CSV
        </a>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Who works the Sundays and public holidays of {monthTitle(month)}, and how evenly. There are{" "}
        {report.sundays} Sundays that are not holidays and {report.holidays} public holidays this
        month. Staff with no brand open on those days (including the backup pool) ({structural}{" "}
        people here) cannot be asked to work them, so they are shown but left out of the comparison.
        The engine rotates a holiday duty between people who can do it; a single-person brand has no
        one to rotate with, which this report makes visible.
      </p>

      <dl
        className="grid grid-cols-1 divide-y divide-border border-y border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0"
        data-testid="fairness-summary"
      >
        <SpreadCard
          title="Sundays worked"
          hint="Per person who can work Sundays."
          s={report.sundaySpread}
          names={names}
        />
        <SpreadCard
          title="Public holidays worked"
          hint="Per person who can work holidays."
          s={report.holidaySpread}
          names={names}
        />
        <SpreadCard
          title="Sundays + holidays worked"
          hint="The premium days together."
          s={report.premiumSpread}
          names={names}
        />
      </dl>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm" data-testid="fairness-table">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Employee</th>
              <th className="px-3 py-2 font-medium">Pod</th>
              <th className="px-3 py-2 text-right font-medium">Sundays worked</th>
              <th className="px-3 py-2 text-right font-medium">Sundays off</th>
              <th className="px-3 py-2 text-right font-medium">Holidays worked</th>
              <th className="px-3 py-2 text-right font-medium">Holidays off</th>
              <th className="px-3 py-2 text-right font-medium">Premium days</th>
              <th className="px-3 py-2 text-right font-medium">Working days</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr
                key={r.employeeId}
                className={cn(
                  "border-t border-border",
                  !r.sundayEligible && !r.holidayEligible && "text-muted-foreground",
                )}
              >
                <td className="px-3 py-1.5">
                  {r.name}
                  {!r.sundayEligible && !r.holidayEligible && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">
                      no brand open
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">{pods.get(r.podId)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.sundaysWorked}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.sundaysOff}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {r.holidaysWorked}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.holidaysOff}</td>
                <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                  {r.premiumDaysWorked}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.workingDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
