import { notFound } from "next/navigation";
import { RosterWorkbench } from "@/components/roster/roster-workbench";
import { isMonth } from "@/lib/config";
import { prisma } from "@/server/db";
import { loadRosterPage } from "@/server/pageData";

export const dynamic = "force-dynamic";

export default async function RosterPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!isMonth(month)) notFound();
  const data = await loadRosterPage(prisma, month);
  return <RosterWorkbench data={data} />;
}
