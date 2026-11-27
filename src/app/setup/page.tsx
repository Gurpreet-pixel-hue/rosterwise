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
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Setup</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Everything the scheduling engine uses is data you can change here: who works where, what
          each brand needs and when it operates, holidays, and leave. Nothing is hard-coded. A
          change applies to the next roster you generate or re-plan. Saved cells are never rewritten
          under you, but an existing roster&apos;s issues and suggestions are re-checked against the
          new data.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-[#F4F3EE] text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Resource</th>
              <th className="px-4 py-2.5 font-medium">Purpose</th>
              <th className="px-4 py-2.5 text-right font-medium">Records</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {RESOURCE_DEFS.map((d) => (
              <tr key={d.slug} className="transition-colors hover:bg-muted/40">
                <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">
                  <Link href={`/setup/${d.slug}`} className="text-primary hover:underline">
                    {d.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{d.description}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-foreground">
                  {n.get(d.slug)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
