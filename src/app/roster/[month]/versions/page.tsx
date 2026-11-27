import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { ChangeDiff } from "@/components/roster/change-diff";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { isMonth } from "@/lib/config";
import { monthTitle } from "@/lib/roster-view";
import { prisma } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { loadRosterPage } from "@/server/pageData";
import { compareVersions } from "@/server/services/roster";

export const dynamic = "force-dynamic";

const num = (v: string | string[] | undefined) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export default async function VersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ month: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { month } = await params;
  if (!isMonth(month)) notFound();
  const q = await searchParams;
  const data = await loadRosterPage(prisma, month);
  const versions = data.versions;
  const latest = versions[versions.length - 1];
  const from = num(q.from) ?? (versions.length > 1 ? versions[versions.length - 2].version : null);
  const to = num(q.to) ?? latest?.version ?? null;

  let comparison = null;
  let error: string | null = null;
  if (from !== null && to !== null && versions.length > 0) {
    try {
      comparison = await compareVersions(prisma, { month, from, to });
    } catch (e) {
      if (e instanceof ServiceError) error = e.message;
      else throw e;
    }
  }

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
        <h1 className="text-lg font-semibold tracking-tight">Compare versions</h1>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Every regenerate and every applied change keeps the version it started from. Pick any two to
        see which cells differ and which issues appeared or went away: a lightweight way to weigh
        alternative plans. Issues are those the validator finds on each version with today&apos;s
        master data.
      </p>

      {versions.length < 2 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {versions.length === 0
            ? `${monthTitle(month)} has not been generated yet.`
            : "There is only one version so far. Regenerate, or apply a change from What if..., to create another."}
        </p>
      ) : (
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3"
        >
          {(
            [
              ["from", "Earlier version", from],
              ["to", "Later version", to],
            ] as const
          ).map(([name, label, value]) => (
            <div key={name} className="space-y-1.5">
              <Label htmlFor={name}>{label}</Label>
              <NativeSelect
                id={name}
                name={name}
                defaultValue={String(value ?? "")}
                className="w-56"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.version}>
                    Version {v.version} ({v.status.toLowerCase()},{" "}
                    {v.createdAt.slice(0, 16).replace("T", " ")})
                  </option>
                ))}
              </NativeSelect>
            </div>
          ))}
          <Button type="submit">Compare</Button>
        </form>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {comparison && (
        <div className="space-y-3" data-testid="version-comparison">
          <ChangeDiff
            title={`Version ${comparison.to.version} compared with version ${comparison.from.version}`}
            data={{ ...comparison, suggestions: [], affectedMonths: [] }}
            refs={data.refs}
            month={month}
          />
        </div>
      )}
    </div>
  );
}
