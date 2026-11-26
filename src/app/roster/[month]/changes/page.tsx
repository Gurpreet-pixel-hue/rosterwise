import { notFound } from "next/navigation";
import { ChangesWorkbench } from "@/components/roster/changes-workbench";
import { DEMO_TODAY, isMonth } from "@/lib/config";
import { prisma } from "@/server/db";
import { loadRosterPage } from "@/server/pageData";

export const dynamic = "force-dynamic";

export default async function ChangesPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!isMonth(month)) notFound();
  const data = await loadRosterPage(prisma, month);
  return <ChangesWorkbench data={data} today={DEMO_TODAY} />;
}
