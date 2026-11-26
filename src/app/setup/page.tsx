import Link from "next/link";
import { RESOURCE_DEFS } from "@/components/setup/resources";
import { prisma } from "@/server/db";
import { listRecords } from "@/server/services/master";

export const dynamic = "force-dynamic";

export default async function SetupHome() {
  const counts = await Promise.all(
    RESOURCE_DEFS.map(
      async (d) => [d.slug, (await listRecords(prisma, d.resource)).length] as const,
    ),
  );
  const n = new Map(counts);
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Setup</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Everything the scheduling engine uses is data you can change here: who works where, what
          each brand needs and when it operates, holidays, and leave. Nothing is hard-coded. A
          change applies to the next roster you generate or re-plan; saved rosters are never
          rewritten under you.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RESOURCE_DEFS.map((d) => (
          <Link
            key={d.slug}
            href={`/setup/${d.slug}`}
            className="rounded-lg border p-4 transition-colors hover:bg-accent"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">{d.title}</h2>
              <span className="text-sm tabular-nums text-muted-foreground">{n.get(d.slug)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
