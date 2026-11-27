"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  GitCompare,
  History,
  PanelRightClose,
  PanelRightOpen,
  Scale,
  Search,
  X,
} from "lucide-react";
import { generateRosterAction, publishRosterAction } from "@/server/actions/roster";
import type { RosterPageData } from "@/server/pageData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
  issuesInView,
  monthTitle,
  shiftMonth,
  visibleBrandProcesses,
  visibleEmployees,
  type ViewKind,
} from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import { ApprovalPanel } from "./approval-panel";
import { BackupPanel } from "./backup-panel";
import { CellDialog, type CellTarget } from "./cell-dialog";
import { IssuesPanel } from "./issues-panel";
import { RosterGrid } from "./roster-grid";
import { Legend } from "./status-style";
import { WhoWorking } from "./who-working";

/** Issues that need a person's attention: ERROR and WARNING. INFO (comp-off notes) is not counted. */
const reviewCount = (issues: ReadonlyArray<{ severity: string }>) =>
  issues.filter((i) => i.severity !== "INFO").length;

export function RosterWorkbench({ data }: { data: RosterPageData }) {
  const router = useRouter();
  const { month, refs, view } = data;

  const [kind, setKind] = useState<ViewKind>("company");
  const [filter, setFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [date, setDate] = useState<string>(data.monthDates[0]);
  const [bpSel, setBpSel] = useState<string | null>(null);
  const [side, setSide] = useState<"issues" | "day" | "backups" | "approval">("issues");
  const [cell, setCell] = useState<CellTarget | null>(null);
  const [highlight, setHighlight] = useState<{ key: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [busy, setBusy] = useState<"generate" | "publish" | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const [onlyView, setOnlyView] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);

  const options = useMemo(() => filterOptions(kind, refs), [kind, refs]);
  const filterValue = options.some((o) => o.value === filter) ? filter : (options[0]?.value ?? "");
  const employees = useMemo(
    () => visibleEmployees(kind, filterValue, refs),
    [kind, filterValue, refs],
  );
  const shownEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, search]);

  const bps = useMemo(
    () => visibleBrandProcesses(kind, filterValue, refs),
    [kind, filterValue, refs],
  );
  const employeeIds = useMemo(() => new Set(employees.map((e) => e.id)), [employees]);
  const bpIds = useMemo(() => new Set(bps.map((b) => b.id)), [bps]);

  const scoped = onlyView && kind !== "company";
  const shownIssues = useMemo(
    () => (scoped && view ? issuesInView(view.issues, employeeIds, bpIds) : (view?.issues ?? [])),
    [scoped, view, employeeIds, bpIds],
  );
  const viewBackups = useMemo(
    () => data.backups.filter((b) => bpIds.has(b.brandProcessId)),
    [data.backups, bpIds],
  );
  const podsWithPeople = new Set(refs.employees.filter((e) => e.isActive).map((e) => e.podId)).size;
  const approvedPods = view?.podApprovals.length ?? 0;
  const missingApprovals = view?.requirePodApprovals
    ? Math.max(0, podsWithPeople - approvedPods)
    : 0;
  const exposedCount = viewBackups.filter(
    (b) => b.status === "EXPOSED" || b.status === "NO_STAFF",
  ).length;
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
  }, [pendingJump, kind, filterValue, search]);

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
      setSearch("");
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
    <div className="mx-auto flex w-full max-w-[2360px] flex-col gap-2 px-3 py-2 lg:h-[calc(100dvh-45px)] lg:overflow-hidden lg:px-5 lg:py-2.5">
      {/* Compact two-row command bar */}
      <div className="shrink-0 border-b border-border pb-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-1">
            <Link
              href={`/roster/${shiftMonth(month, -1)}`}
              aria-label="Previous month"
              className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <h1 className="min-w-36 text-center text-base font-semibold tracking-tight text-foreground">
              {monthTitle(month)}
            </h1>
            <Link
              href={`/roster/${shiftMonth(month, 1)}`}
              aria-label="Next month"
              className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
          {view ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={view.roster.status === "PUBLISHED" ? "default" : "secondary"}
                data-testid="status-badge"
              >
                {view.roster.status}
              </Badge>
              <span
                className="font-mono text-xs tabular-nums text-muted-foreground"
                data-testid="version-label"
              >
                version {view.roster.version} of {data.versions.length}
              </span>
              <span className="text-xs text-muted-foreground">|</span>
              <span className="text-[13px]">
                <strong
                  className={cn(
                    "font-mono tabular-nums",
                    errors > 0 ? "text-[#B91C1C]" : "text-foreground",
                  )}
                >
                  {errors}
                </strong>{" "}
                errors,{" "}
                <strong className="font-mono tabular-nums text-foreground">{warnings}</strong>{" "}
                warnings
                {manualCount > 0 && (
                  <span className="text-muted-foreground">
                    , <span className="font-mono tabular-nums">{manualCount}</span> edited by hand
                  </span>
                )}
              </span>
            </div>
          ) : (
            <Badge variant="outline">Not generated</Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Link
              href={`/roster/${month}/changes`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <GitCompare className="size-3.5 text-muted-foreground" /> What if...
            </Link>
            {view && (
              <Link
                href={`/roster/${month}/fairness`}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Scale className="size-3.5 text-muted-foreground" /> Fairness
              </Link>
            )}
            {view && data.versions.length > 1 && (
              <Link
                href={`/roster/${month}/versions`}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <History className="size-3.5 text-muted-foreground" /> Versions
              </Link>
            )}
            {view && !confirmRegen && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => setConfirmRegen(true)}
              >
                {view.roster.status === "PUBLISHED" ? "Regenerate as new draft" : "Regenerate"}
              </Button>
            )}
            {view && confirmRegen && (
              <span className="flex items-center gap-1.5 rounded-md border border-border bg-muted/70 p-1 pl-2.5 text-xs">
                {view.roster.status === "PUBLISHED"
                  ? `Creates draft version ${view.roster.version + 1}; published version ${view.roster.version} stays in history.`
                  : `New version ${view.roster.version + 1}; keeps ${manualCount} manual edit(s).`}
                <Button size="xs" onClick={generate} disabled={busy !== null}>
                  Regenerate
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirmRegen(false)}>
                  Cancel
                </Button>
              </span>
            )}
            {view && (
              <Button
                onClick={publish}
                disabled={!editable || blockers > 0 || missingApprovals > 0 || busy !== null}
                title={
                  !editable
                    ? (readOnlyReason ?? "")
                    : blockers > 0
                      ? `${blockers} error(s) must be fixed or acknowledged first`
                      : missingApprovals > 0
                        ? `${missingApprovals} pod(s) still need their lead's approval`
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

        {view && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <Tabs value={kind} onValueChange={(v) => setKind(v as ViewKind)}>
              <TabsList variant="line" aria-label="Roster views">
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
                className="h-7 w-44 text-xs xl:w-56"
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
            {kind !== "employee" && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Filter people by name"
                  placeholder="Filter person..."
                  className="h-7 w-36 pl-7 text-xs xl:w-44"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {shownEmployees.length} people · {bps.length} brand rules
              </span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Download className="size-3" aria-hidden />
                <span className="sr-only">Export this view as CSV:</span>
                {(
                  [
                    ["grid", "Grid"],
                    ["coverage", "Coverage"],
                    ["issues", "Issues"],
                  ] as const
                ).map(([what, label]) => (
                  <a
                    key={what}
                    href={`/roster/${month}/export?what=${what}&kind=${kind}&value=${encodeURIComponent(filterValue)}`}
                    download
                    aria-label={`Export ${label.toLowerCase()} as CSV`}
                    className="rounded px-1 py-0.5 underline-offset-2 hover:bg-muted hover:text-foreground hover:underline"
                  >
                    {label}
                  </a>
                ))}
              </span>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
                title={panelOpen ? "Hide side panel" : "Show side panel"}
                onClick={() => setPanelOpen((o) => !o)}
              >
                {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            </div>
          </div>
        )}
      </div>

      {view && editable && blockers > 0 && (
        <p className="shrink-0 text-xs text-muted-foreground" data-testid="publish-hint">
          Publishing is blocked by{" "}
          <strong className="font-mono tabular-nums text-[#B91C1C]">{blockers}</strong> error(s).
          Fix each one, or acknowledge it with a note in the Issues panel.
        </p>
      )}
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "shrink-0 flex items-start gap-2 rounded-md border px-3 py-1.5 text-xs",
            notice.tone === "error"
              ? "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"
              : "border-[#BBF7D0] bg-[#E6F4EA] text-[#14532D]",
          )}
        >
          <span className="flex-1">{notice.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="opacity-70 hover:opacity-100"
            onClick={() => setNotice(null)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {!view && (
        <div className="rounded-md border border-dashed border-border bg-card p-10 text-center">
          <h2 className="font-medium text-foreground">No roster for {monthTitle(month)} yet</h2>
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
          <div
            className={cn(
              "grid min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-card",
              panelOpen ? "lg:grid-cols-[minmax(0,1fr)_clamp(285px,23vw,410px)]" : "grid-cols-1",
            )}
          >
            <div className="flex min-h-0 min-w-0 flex-col">
              <RosterGrid
                month={month}
                window={data.window}
                employees={shownEmployees}
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
                  setPanelOpen(true);
                }}
                onStrip={(bpId, d) => {
                  setDate(d);
                  setBpSel(bpId);
                  setSide("day");
                  setPanelOpen(true);
                }}
              />
              <div className="shrink-0 space-y-1 border-t border-border bg-[#F8F8F5] px-3 py-1.5">
                <Legend />
                <p className="text-[11px] text-muted-foreground">
                  Dates outside {monthTitle(month)} are the boundary week and belong to the
                  neighbouring roster; they show here read-only (dashed). Coverage rows count only{" "}
                  {monthTitle(month)}.
                </p>
              </div>
            </div>

            {panelOpen && (
              <aside className="flex min-h-0 min-w-0 flex-col border-t border-border bg-card lg:border-l lg:border-t-0">
                <div
                  className="flex shrink-0 border-b border-border px-3 pt-1"
                  role="tablist"
                  aria-label="Side panel"
                >
                  {(
                    [
                      ["issues", `Issues (${reviewCount(shownIssues)})`],
                      ["day", "Day"],
                      ["backups", `Backups (${exposedCount})`],
                      ["approval", `Approval (${approvedPods}/${podsWithPeople})`],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={side === id}
                      onClick={() => setSide(id)}
                      title={id === "day" ? "Who's working on the selected date" : undefined}
                      className={cn(
                        "-mb-px whitespace-nowrap border-b-2 px-2.5 py-2 text-xs font-medium transition-colors",
                        side === id
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {side === "issues" && kind !== "company" && (
                    <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={onlyView}
                        onCheckedChange={(c) => setOnlyView(Boolean(c))}
                      />
                      <span>
                        Only issues in this view ({reviewCount(shownIssues)} of{" "}
                        {reviewCount(view.issues)} to review)
                      </span>
                    </label>
                  )}
                  {side === "approval" ? (
                    <ApprovalPanel
                      rosterId={view.roster.id}
                      refs={refs}
                      approvals={view.podApprovals}
                      required={view.requirePodApprovals}
                      editable={editable}
                      onDone={refresh}
                    />
                  ) : side === "backups" ? (
                    <BackupPanel reports={viewBackups} onDone={refresh} />
                  ) : side === "issues" ? (
                    <IssuesPanel
                      issues={shownIssues}
                      names={{
                        employee: (id) => refs.employees.find((e) => e.id === id)?.name ?? id,
                        bp: (id) => {
                          const b = refs.brandProcesses.find((x) => x.id === id);
                          return b ? `${b.brandName} / ${b.processCode}` : id;
                        },
                      }}
                      emptyText={
                        scoped
                          ? `No issues in this view (${reviewCount(view.issues) - reviewCount(shownIssues)} to review elsewhere in the roster).`
                          : "No issues. This roster is valid."
                      }
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
                </div>
              </aside>
            )}
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
