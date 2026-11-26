"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, GitCompare, X } from "lucide-react";
import { generateRosterAction, publishRosterAction } from "@/server/actions/roster";
import type { RosterPageData } from "@/server/pageData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ACTOR } from "@/lib/config";
import {
  VIEW_KINDS,
  VIEW_LABEL,
  cellKey,
  entryIndex,
  filterOptions,
  issueTarget,
  issuesByBpDay,
  issuesByCell,
  monthTitle,
  shiftMonth,
  visibleBrandProcesses,
  visibleEmployees,
  type ViewKind,
} from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import { CellDialog, type CellTarget } from "./cell-dialog";
import { IssuesPanel } from "./issues-panel";
import { RosterGrid } from "./roster-grid";
import { Legend } from "./status-style";
import { WhoWorking } from "./who-working";

export function RosterWorkbench({ data }: { data: RosterPageData }) {
  const router = useRouter();
  const { month, refs, view } = data;

  const [kind, setKind] = useState<ViewKind>("company");
  const [filter, setFilter] = useState<string>("");
  const [date, setDate] = useState<string>(data.monthDates[0]);
  const [bpSel, setBpSel] = useState<string | null>(null);
  const [side, setSide] = useState<"issues" | "day">("issues");
  const [cell, setCell] = useState<CellTarget | null>(null);
  const [highlight, setHighlight] = useState<{ key: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [busy, setBusy] = useState<"generate" | "publish" | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [pendingJump, setPendingJump] = useState<string | null>(null);

  const options = useMemo(() => filterOptions(kind, refs), [kind, refs]);
  const filterValue = options.some((o) => o.value === filter) ? filter : (options[0]?.value ?? "");
  const employees = useMemo(
    () => visibleEmployees(kind, filterValue, refs),
    [kind, filterValue, refs],
  );
  const bps = useMemo(
    () => visibleBrandProcesses(kind, filterValue, refs),
    [kind, filterValue, refs],
  );
  const employeeIds = useMemo(() => new Set(employees.map((e) => e.id)), [employees]);

  const entries = useMemo(() => entryIndex(view?.entries ?? []), [view]);
  const byCell = useMemo(() => issuesByCell(view?.issues ?? []), [view]);
  const byBp = useMemo(() => issuesByBpDay(view?.issues ?? []), [view]);

  const editable = !!view && view.roster.status === "DRAFT" && view.isLatest;
  const readOnlyReason = !view
    ? null
    : view.roster.status === "PUBLISHED"
      ? `Version ${view.roster.version} is published and cannot be edited. To change it, use "What if..." and apply a change: that creates a new draft version.`
      : !view.isLatest
        ? "This is not the latest version, so it is read-only."
        : null;

  // after a jump, scroll the target into view once the right rows are on screen
  useEffect(() => {
    if (!pendingJump) return;
    const el = document.querySelector<HTMLElement>(
      `[data-cell="${pendingJump}"], [data-strip="${pendingJump}"]`,
    );
    if (el) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    }
    setPendingJump(null);
    const t = setTimeout(() => setHighlight(null), 3500);
    return () => clearTimeout(t);
  }, [pendingJump, kind, filterValue]);

  function say(text: string, tone: "ok" | "error" = "ok") {
    setNotice({ text, tone });
  }
  function refresh(text: string) {
    say(text);
    router.refresh();
  }

  function jump(issue: Parameters<typeof issueTarget>[0]) {
    const t = issueTarget(issue);
    if (!t) return;
    setDate(t.date);
    if (t.kind === "cell") {
      if (!employeeIds.has(t.employeeId)) {
        setKind("company");
        setFilter("");
      }
      const key = cellKey(t.employeeId, t.date);
      setHighlight({ key });
      setPendingJump(key);
    } else {
      if (!bps.some((b) => b.id === t.bpId)) {
        setKind("company");
        setFilter("");
      }
      const key = cellKey(t.bpId, t.date);
      setHighlight({ key });
      setBpSel(t.bpId);
      setPendingJump(key);
    }
  }

  async function generate() {
    setBusy("generate");
    setConfirmRegen(false);
    const r = await generateRosterAction({ month, actor: ACTOR });
    setBusy(null);
    if (!r.ok) return say(r.error.message, "error");
    const errs = r.data.issues.filter((i) => i.severity === "ERROR").length;
    refresh(
      `Generated ${monthTitle(month)}, version ${r.data.roster.version}: ${errs} error(s) to review.${
        r.data.carriedAcknowledgements
          ? ` ${r.data.carriedAcknowledgements} acknowledgement(s) carried over.`
          : ""
      }`,
    );
  }

  async function publish() {
    if (!view) return;
    setBusy("publish");
    const r = await publishRosterAction({ rosterId: view.roster.id, actor: ACTOR });
    setBusy(null);
    if (!r.ok) return say(r.error.message, "error");
    refresh(
      `Published version ${r.data.roster.version}. ${r.data.acknowledgedErrors} error(s) were acknowledged; ${r.data.compOffCreditsCreated} comp-off credit(s) created${
        r.data.compOffCreditsRetracted ? `, ${r.data.compOffCreditsRetracted} retracted` : ""
      }.`,
    );
  }

  const errors = view?.issues.filter((i) => i.severity === "ERROR").length ?? 0;
  const warnings = view?.issues.filter((i) => i.severity === "WARNING").length ?? 0;
  const blockers = view?.blockers.length ?? 0;
  const manualCount =
    view?.entries.filter((e) => e.source === "MANUAL" && e.date.slice(0, 7) === month).length ?? 0;

  const scopeLabel =
    kind === "company"
      ? "everyone"
      : `${VIEW_LABEL[kind]}: ${options.find((o) => o.value === filterValue)?.label ?? ""}`;

  return (
    <div className="mx-auto max-w-[1800px] space-y-3 px-4 py-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={`/roster/${shiftMonth(month, -1)}`}
            aria-label="Previous month"
            className="inline-flex size-8 items-center justify-center rounded-lg border hover:bg-accent"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <h1 className="min-w-44 text-center text-lg font-semibold tracking-tight">
            {monthTitle(month)}
          </h1>
          <Link
            href={`/roster/${shiftMonth(month, 1)}`}
            aria-label="Next month"
            className="inline-flex size-8 items-center justify-center rounded-lg border hover:bg-accent"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
        {view ? (
          <div className="flex items-center gap-2">
            <Badge
              variant={view.roster.status === "PUBLISHED" ? "default" : "secondary"}
              data-testid="status-badge"
            >
              {view.roster.status}
            </Badge>
            <span className="text-sm text-muted-foreground" data-testid="version-label">
              version {view.roster.version} of {data.versions.length}
            </span>
            <span className="text-sm">
              <strong className={errors > 0 ? "text-red-700" : ""}>{errors}</strong> errors,{" "}
              <strong>{warnings}</strong> warnings
              {manualCount > 0 && (
                <span className="text-muted-foreground">, {manualCount} edited by hand</span>
              )}
            </span>
          </div>
        ) : (
          <Badge variant="outline">Not generated</Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            href={`/roster/${month}/changes`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm hover:bg-accent"
          >
            <GitCompare className="size-4" /> What if...
          </Link>
          {view && !confirmRegen && (
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => setConfirmRegen(true)}
            >
              Regenerate
            </Button>
          )}
          {view && confirmRegen && (
            <span className="flex items-center gap-1.5 rounded-lg border bg-muted/50 p-1 pl-2.5 text-sm">
              New version {view.roster.version + 1}; your {manualCount} manual edit(s) are kept.
              <Button size="sm" onClick={generate} disabled={busy !== null}>
                Regenerate
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(false)}>
                Cancel
              </Button>
            </span>
          )}
          {view && (
            <Button
              onClick={publish}
              disabled={!editable || blockers > 0 || busy !== null}
              title={
                !editable
                  ? (readOnlyReason ?? "")
                  : blockers > 0
                    ? `${blockers} error(s) must be fixed or acknowledged first`
                    : "Publish this version"
              }
            >
              {busy === "publish"
                ? "Publishing..."
                : view.roster.status === "PUBLISHED"
                  ? "Published"
                  : "Publish"}
            </Button>
          )}
        </div>
      </div>

      {view && editable && blockers > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="publish-hint">
          Publishing is blocked by <strong className="text-red-700">{blockers}</strong> error(s).
          Fix each one, or acknowledge it with a note in the Issues panel.
        </p>
      )}
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-2 rounded-md border p-2.5 text-sm",
            notice.tone === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-emerald-300 bg-emerald-50 text-emerald-950",
          )}
        >
          <span className="flex-1">{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X className="size-4" />
          </button>
        </div>
      )}

      {!view && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <h2 className="font-medium">No roster for {monthTitle(month)} yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            The engine builds it from each brand&apos;s operating calendar and every employee&apos;s
            availability. Any constraint it cannot meet becomes an issue you can see, never a silent
            gap.
          </p>
          <Button className="mt-4" onClick={generate} disabled={busy !== null}>
            {busy === "generate" ? "Generating..." : `Generate ${monthTitle(month)}`}
          </Button>
        </div>
      )}

      {view && (
        <>
          {/* views */}
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={kind} onValueChange={(v) => setKind(v as ViewKind)}>
              <TabsList aria-label="Roster views">
                {VIEW_KINDS.map((k) => (
                  <TabsTrigger key={k} value={k}>
                    {VIEW_LABEL[k]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {options.length > 0 && (
              <NativeSelect
                aria-label={`Choose ${VIEW_LABEL[kind].toLowerCase()}`}
                className="w-60"
                value={filterValue}
                onChange={(e) => setFilter(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            )}
            <span className="text-xs text-muted-foreground">
              {employees.length} people, {bps.length} brand rules
            </span>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-2">
              <RosterGrid
                month={month}
                window={data.window}
                employees={employees}
                entries={entries}
                issuesByCell={byCell}
                refs={refs}
                foreignDates={view.foreignDates}
                brandProcesses={bps}
                coverage={view.coverage}
                issuesByBpDay={byBp}
                selectedDate={date}
                selectedBp={bpSel}
                highlight={highlight}
                onCell={(employeeId, d) => {
                  setDate(d);
                  setCell({ employeeId, date: d });
                }}
                onDate={(d) => {
                  setDate(d);
                  setSide("day");
                }}
                onStrip={(bpId, d) => {
                  setDate(d);
                  setBpSel(bpId);
                  setSide("day");
                }}
              />
              <Legend />
              <p className="text-xs text-muted-foreground">
                Dates outside {monthTitle(month)} are the boundary week and belong to the
                neighbouring roster; they show here read-only (dashed). The coverage rows count only{" "}
                {monthTitle(month)}.
              </p>
            </div>

            <aside className="min-w-0 rounded-lg border p-3 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">
              <div
                className="mb-3 flex gap-1 rounded-lg bg-muted p-0.5"
                role="tablist"
                aria-label="Side panel"
              >
                {(
                  [
                    [
                      "issues",
                      `Issues (${view.issues.filter((i) => i.severity !== "INFO").length})`,
                    ],
                    ["day", "Who's working"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={side === id}
                    onClick={() => setSide(id)}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1 text-sm font-medium",
                      side === id ? "bg-background shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {side === "issues" ? (
                <IssuesPanel
                  issues={view.issues}
                  explanations={view.explanations}
                  rosterId={view.roster.id}
                  editable={editable}
                  readOnlyReason={readOnlyReason}
                  onJump={jump}
                  onDone={refresh}
                />
              ) : (
                <WhoWorking
                  date={date}
                  window={data.window}
                  entries={view.entries}
                  refs={refs}
                  employeeIds={employeeIds}
                  coverage={view.coverage}
                  selectedBp={bpSel}
                  scopeLabel={scopeLabel}
                  onDate={setDate}
                />
              )}
            </aside>
          </div>

          <CellDialog
            target={cell}
            entry={cell ? entries.get(cellKey(cell.employeeId, cell.date)) : undefined}
            refs={refs}
            rosterId={view.roster.id}
            rosterMonth={month}
            editable={editable}
            readOnlyReason={readOnlyReason}
            foreignMonth={cell ? (view.foreignDates[cell.date] ?? null) : null}
            issues={cell ? (byCell.get(cellKey(cell.employeeId, cell.date)) ?? []) : []}
            onClose={() => setCell(null)}
            onSaved={(m) => {
              setCell(null);
              refresh(m);
            }}
          />
        </>
      )}
    </div>
  );
}
