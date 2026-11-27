import { NextResponse, type NextRequest } from "next/server";
import { isMonth } from "@/lib/config";
import {
  csvFor,
  coverageRows,
  exportFileName,
  gridRows,
  isExportWhat,
  isViewKind,
  issueRows,
} from "@/lib/roster-export";
import {
  filterOptions,
  issuesInView,
  visibleBrandProcesses,
  visibleEmployees,
} from "@/lib/roster-view";
import { prisma } from "@/server/db";
import { loadRosterPage } from "@/server/pageData";

export const dynamic = "force-dynamic";

/**
 * GET /roster/2026-12/export?what=grid|coverage|issues&kind=company|pod|brand|process|employee&value=<id>
 * Read-only: it exports exactly what the same view shows, from the latest version of the month.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const q = req.nextUrl.searchParams;
  const what = q.get("what") ?? "grid";
  const kind = q.get("kind") ?? "company";
  const value = q.get("value") ?? "";
  if (!isMonth(month) || !isExportWhat(what) || !isViewKind(kind) || value.length > 100) {
    return new NextResponse("Bad export request", { status: 400 });
  }
  const data = await loadRosterPage(prisma, month);
  if (!data.view)
    return new NextResponse(`No roster for ${month} yet. Generate it first.`, { status: 404 });
  const options = filterOptions(kind, data.refs);
  // an unknown filter value falls back to the first choice, as the page does
  const v = options.some((o) => o.value === value) ? value : (options[0]?.value ?? "");
  const label = options.find((o) => o.value === v)?.label ?? "";

  let rows: string[][];
  if (what === "grid") {
    rows = gridRows({
      kind,
      value: v,
      window: data.window,
      entries: data.view.entries,
      refs: data.refs,
    });
  } else if (what === "coverage") {
    rows = coverageRows({
      kind,
      value: v,
      monthDates: data.monthDates,
      coverage: data.view.coverage,
      refs: data.refs,
    });
  } else {
    const employeeIds = new Set(visibleEmployees(kind, v, data.refs).map((e) => e.id));
    const bpIds = new Set(visibleBrandProcesses(kind, v, data.refs).map((b) => b.id));
    rows = issueRows({
      issues:
        kind === "company" ? data.view.issues : issuesInView(data.view.issues, employeeIds, bpIds),
      refs: data.refs,
    });
  }
  return new NextResponse(csvFor(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(month, kind, label, what)}"`,
      "Cache-Control": "no-store",
    },
  });
}
