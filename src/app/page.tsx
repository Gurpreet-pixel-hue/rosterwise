import Link from "next/link";
import { DEMO_MONTH } from "@/lib/config";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">RosterWise</h1>
        <p className="text-muted-foreground">
          Monthly rosters for a company that staffs customer-support teams for many brands. The
          scheduling engine keeps what each brand needs (its operating calendar) separate from who
          is available (each person&apos;s schedule), and it never hands you an invalid roster
          without saying so.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`/roster/${DEMO_MONTH}`}
          className="rounded-lg border p-5 transition-colors hover:bg-accent"
        >
          <h2 className="font-medium">Roster</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate a month, read it five ways, fix conflicts, and see what a change would do.
          </p>
        </Link>
        <Link href="/setup" className="rounded-lg border p-5 transition-colors hover:bg-accent">
          <h2 className="font-medium">Setup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Employees, pods, brands, rules, assignments, holidays and leave. Everything is data.
          </p>
        </Link>
      </div>
    </main>
  );
}
