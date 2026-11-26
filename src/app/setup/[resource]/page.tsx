import { notFound } from "next/navigation";
import { ResourceManager } from "@/components/setup/resource-manager";
import { defBySlug, type Row } from "@/components/setup/resources";
import { prisma } from "@/server/db";
import { loadLookups } from "@/server/pageData";
import { listRecords } from "@/server/services/master";

export const dynamic = "force-dynamic";

export default async function SetupResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const { resource } = await params;
  const def = defBySlug(resource);
  if (!def) notFound();
  const [rows, lookups] = await Promise.all([
    listRecords(prisma, def.resource),
    loadLookups(prisma),
  ]);
  // plain JSON across the server/client boundary (dates in rows become strings)
  return (
    <ResourceManager
      slug={def.slug}
      rows={JSON.parse(JSON.stringify(rows)) as Row[]}
      lookups={lookups}
    />
  );
}
