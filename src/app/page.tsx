import Link from "next/link";
import { DEMO_MONTH } from "@/lib/config";
import { dayLabel, monthTitle } from "@/lib/roster-view";
import { prisma } from "@/server/db";
import { loadRosterPage } from "@/server/pageData";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await loadRosterPage(prisma, DEMO_MONTH);
  const { refs, view } = data;

  const activeEmployees = refs.employees.filter((e) => e.isActive);
  const empPod = new Map(refs.employees.map((e) => [e.id, e.podId]));
  const bpPod = new Map(refs.brandProcesses.map((b) => [b.id, b.brandPodId]));

  const pendingLeaves = refs.leaves.filter((l) => l.status === "PENDING");
  const empName = new Map(refs.employees.map((e) => [e.id, e.name]));

  const errors = view ? view.issues.filter((i) => i.severity === "ERROR") : [];
  const blockers = view?.blockers.length ?? 0;

  const podRows = refs.pods.map((pod) => {
    const people = activeEmployees.filter((e) => e.podId === pod.id).length;
    const brands = refs.brands.filter((b) => b.podId === pod.id).length;
    const podErrors = errors.filter((issue) => {
      const pId = issue.employeeId
        ? empPod.get(issue.employeeId)
        : issue.brandProcessId
          ? bpPod.get(issue.brandProcessId)
          : undefined;
      return pId === pod.id;
    }).length;
    return { id: pod.id, name: pod.name, people, brands, podErrors };
  });

  const statusLine = !view
    ? `${monthTitle(DEMO_MONTH)} · Not generated yet`
    : `${monthTitle(DEMO_MONTH)} · ${
        view.roster.status === "PUBLISHED" ? "Published" : "Draft"
      }, version ${view.roster.version} of ${data.versions.length}`;

  return (
    <main className="mx-auto max-w-[1360px] space-y-7 px-4 py-6 lg:px-6 lg:py-8 xl:max-w-[1480px]">
      {/* Masthead */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">RosterWise</h1>
          <p className="font-mono text-xs text-muted-foreground">{statusLine}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/setup"
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Setup
          </Link>
          <Link
            href={`/roster/${DEMO_MONTH}`}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open roster
          </Link>
        </div>
      </header>

      {/* Single horizontal ledger strip */}
      <dl className="grid grid-cols-2 divide-y divide-border border-y border-border bg-card md:grid-cols-4 md:divide-x md:divide-y-0">
        <div className="px-4 py-3.5">
          <dt className="text-xs text-muted-foreground">Active staff</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {activeEmployees.length}
          </dd>
        </div>
        <div className="px-4 py-3.5">
          <dt className="text-xs text-muted-foreground">Brand rules</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {refs.brandProcesses.length}
          </dd>
        </div>
        <div className="px-4 py-3.5">
          <dt className="text-xs text-muted-foreground">Publish blockers</dt>
          <dd
            className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
              blockers > 0 ? "text-destructive" : "text-foreground"
            }`}
          >
            {view ? blockers : "—"}
          </dd>
        </div>
        <div className="px-4 py-3.5">
          <dt className="text-xs text-muted-foreground">Pending leave</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {pendingLeaves.length}
          </dd>
        </div>
      </dl>

      {/* Asymmetric 2-column body */}
      <div className="grid gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">
        <section className="space-y-3" aria-labelledby="pods-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="pods-heading" className="text-sm font-semibold text-foreground">
              Pods
            </h2>
            <Link
              href={`/roster/${DEMO_MONTH}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              Inspect schedule
            </Link>
          </div>
          <div className="overflow-x-auto border-y border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Pod</th>
                  <th className="px-3 py-2 text-right font-medium">People</th>
                  <th className="px-3 py-2 text-right font-medium">Brands</th>
                  <th className="px-3 py-2 text-right font-medium">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {podRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      No pods configured yet. Add pods under Setup.
                    </td>
                  </tr>
                )}
                {podRows.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2.5 font-medium text-foreground">
                      <Link href={`/roster/${DEMO_MONTH}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                      {p.people}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                      {p.brands}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                        p.podErrors > 0 ? "font-semibold text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {view ? p.podErrors : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="text-sm font-semibold text-foreground">
            Needs attention
          </h2>
          <ul className="divide-y divide-border border-y border-border bg-card">
            {!view && (
              <li className="px-3.5 py-3 text-sm">
                <div className="font-medium text-foreground">
                  {monthTitle(DEMO_MONTH)} roster not generated
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Generate the initial draft from current brand calendars and availability.
                </p>
                <Link
                  href={`/roster/${DEMO_MONTH}`}
                  className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Open {monthTitle(DEMO_MONTH)}
                </Link>
              </li>
            )}

            {view && blockers > 0 && (
              <li className="px-3.5 py-3 text-sm">
                <div className="font-medium text-destructive">
                  {blockers} unacknowledged error{blockers === 1 ? "" : "s"} blocking publish
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Fix conflicts with one-click suggestions or acknowledge with an audit note.
                </p>
                <Link
                  href={`/roster/${DEMO_MONTH}`}
                  className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Review in roster
                </Link>
              </li>
            )}

            {view && blockers === 0 && (
              <li className="px-3.5 py-3 text-sm">
                <div className="font-medium text-foreground">No publish blockers</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {view.roster.status === "PUBLISHED"
                    ? `${monthTitle(DEMO_MONTH)} v${view.roster.version} is published.`
                    : `${monthTitle(DEMO_MONTH)} v${view.roster.version} is ready to publish.`}
                </p>
              </li>
            )}

            {pendingLeaves.map((l) => (
              <li key={l.id} className="px-3.5 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {empName.get(l.employeeId) ?? l.employeeId}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {dayLabel(l.fromDate)} – {dayLabel(l.toDate)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Pending leave request (not yet applied to the schedule).
                </p>
                <Link
                  href={`/roster/${DEMO_MONTH}/changes`}
                  className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Simulate in What if
                </Link>
              </li>
            ))}

            <li className="px-3.5 py-3 text-xs text-muted-foreground">
              <div className="mb-1.5 font-medium text-foreground">Master data shortcuts</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Link href="/setup/employees" className="text-primary hover:underline">
                  Employees
                </Link>
                <Link href="/setup/brand-processes" className="text-primary hover:underline">
                  Brand rules
                </Link>
                <Link href="/setup/assignments" className="text-primary hover:underline">
                  Assignments
                </Link>
                <Link href="/setup/holidays" className="text-primary hover:underline">
                  Public holidays
                </Link>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
