"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { applyChangeAction, simulateChangeAction } from "@/server/actions/roster";
import type { RosterPageData } from "@/server/pageData";
import type { ApplyChangeResult } from "@/server/services/roster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { WEEKDAYS } from "@/components/setup/resources";
import { ACTOR } from "@/lib/config";
import { dayLabel, monthTitle } from "@/lib/roster-view";
import { ChangeDiff, type DiffData } from "./change-diff";

type Kind =
  | "APPROVE_LEAVE"
  | "ADD_LEAVE"
  | "MAKE_UNAVAILABLE"
  | "REMOVE_LEAVE"
  | "CHANGE_RULE"
  | "CHANGE_MIN_STAFF";

const KINDS: Array<{ id: Kind; label: string; help: string }> = [
  {
    id: "APPROVE_LEAVE",
    label: "Approve a pending leave",
    help: "Pending leave is not applied until approved. Approving it re-plans the weeks it touches.",
  },
  {
    id: "ADD_LEAVE",
    label: "Add leave",
    help: "Someone will be away. The engine re-plans only the weeks affected.",
  },
  {
    id: "MAKE_UNAVAILABLE",
    label: "Make someone unavailable",
    help: "For sick or sudden absence: approved, planned leave for the dates you give.",
  },
  {
    id: "REMOVE_LEAVE",
    label: "Cancel a leave",
    help: "Remove a leave. The person becomes available again.",
  },
  {
    id: "CHANGE_RULE",
    label: "Change a brand's operating rule",
    help: "When a brand's process operates, or its shift.",
  },
  {
    id: "CHANGE_MIN_STAFF",
    label: "Change minimum staffing",
    help: "A new default, or a minimum for one date (a sale day).",
  },
];

type Rule = "ALL_DAYS" | "NO_PUBLIC_HOLIDAYS" | "NO_SUNDAY_NO_PH" | "CUSTOM";

export function ChangesWorkbench({ data, today }: { data: RosterPageData; today: string }) {
  const router = useRouter();
  const { month, refs, view } = data;
  const employees = refs.employees.filter((e) => e.isActive);
  const pending = refs.leaves.filter((l) => l.status === "PENDING");
  const nameOf = (id: string) => refs.employees.find((e) => e.id === id)?.name ?? id;
  const bpOptions = refs.brandProcesses;

  const [kind, setKind] = useState<Kind>(pending.length > 0 ? "APPROVE_LEAVE" : "ADD_LEAVE");
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [from, setFrom] = useState(data.monthDates[14]);
  const [to, setTo] = useState(data.monthDates[14]);
  const [leaveType, setLeaveType] = useState<"PLANNED" | "SICK" | "COMP_OFF">("PLANNED");
  const [leaveId, setLeaveId] = useState(pending[0]?.id ?? "");
  const [bpId, setBpId] = useState(bpOptions[0]?.id ?? "");
  const [rule, setRule] = useState<Rule>("NO_SUNDAY_NO_PH");
  const [weekdays, setWeekdays] = useState<string[]>([]);
  const [phToo, setPhToo] = useState(false);
  const [defMin, setDefMin] = useState("");
  const [ovDate, setOvDate] = useState(data.monthDates[14]);
  const [ovMin, setOvMin] = useState("2");

  const [preview, setPreview] = useState<DiffData | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ result: ApplyChangeResult; parent: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  const change = useMemo(() => {
    switch (kind) {
      case "APPROVE_LEAVE": {
        const l = refs.leaves.find((x) => x.id === leaveId);
        return l
          ? {
              type: "ADD_LEAVE" as const,
              leave: {
                id: l.id,
                employeeId: l.employeeId,
                fromDate: l.fromDate,
                toDate: l.toDate,
                type: l.type,
                status: "APPROVED" as const,
              },
            }
          : null;
      }
      case "ADD_LEAVE":
        return {
          type: "ADD_LEAVE" as const,
          leave: {
            employeeId,
            fromDate: from,
            toDate: to,
            type: leaveType,
            status: "APPROVED" as const,
          },
        };
      case "MAKE_UNAVAILABLE":
        return { type: "MAKE_UNAVAILABLE" as const, employeeId, fromDate: from, toDate: to };
      case "REMOVE_LEAVE":
        return leaveId ? { type: "REMOVE_LEAVE" as const, leaveId } : null;
      case "CHANGE_RULE":
        return {
          type: "CHANGE_RULE" as const,
          brandProcessId: bpId,
          patch: {
            operatingRule: rule,
            ...(rule === "CUSTOM"
              ? { customWeekdays: weekdays, worksOnPublicHolidays: phToo }
              : {}),
          },
        };
      case "CHANGE_MIN_STAFF": {
        const c: Record<string, unknown> = { type: "CHANGE_MIN_STAFF", brandProcessId: bpId };
        if (defMin !== "") c.defaultMinStaff = Number(defMin);
        if (ovDate && ovMin !== "") c.override = { date: ovDate, minStaff: Number(ovMin) };
        return c;
      }
    }
  }, [
    kind,
    refs.leaves,
    leaveId,
    employeeId,
    from,
    to,
    leaveType,
    bpId,
    rule,
    weekdays,
    phToo,
    defMin,
    ovDate,
    ovMin,
  ]);

  const key = JSON.stringify(change);
  const fresh = preview !== null && previewKey === key;
  const help = KINDS.find((k) => k.id === kind)!.help;

  if (!view) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-8">
        <h1 className="text-lg font-semibold">What if...</h1>
        <p className="text-muted-foreground">
          There is no roster for {monthTitle(month)} yet. Generate it first, then come back to try
          changes.
        </p>
        <Link className="underline" href={`/roster/${month}`}>
          Go to the {monthTitle(month)} roster
        </Link>
      </div>
    );
  }

  const leaveChoices = kind === "APPROVE_LEAVE" ? pending : refs.leaves;

  async function run() {
    if (!change) return;
    setBusy("preview");
    setError(null);
    setApplied(null);
    const r = await simulateChangeAction({ rosterId: view!.roster.id, change, today });
    setBusy(null);
    if (!r.ok) {
      setPreview(null);
      return setError(r.error.message);
    }
    setPreview(r.data);
    setPreviewKey(key);
  }

  async function apply() {
    if (!change) return;
    setBusy("apply");
    setError(null);
    const parent = view!.roster.version;
    const r = await applyChangeAction({ rosterId: view!.roster.id, change, actor: ACTOR, today });
    setBusy(null);
    if (!r.ok) return setError(r.error.message);
    setApplied({ result: r.data, parent });
    setPreview(null);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/roster/${month}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {monthTitle(month)} roster
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">What if...</h1>
        <span className="text-sm text-muted-foreground" data-testid="base-version">
          Based on version {view.roster.version} ({view.roster.status.toLowerCase()})
        </span>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Preview a change before it happens: nothing is saved until you apply it. Applying saves the
        change and creates a new draft <em>version</em> of the roster that keeps everything you
        edited by hand and re-plans only the weeks the change touches.
      </p>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <form
          className="space-y-4 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="kind">What changes?</Label>
            <NativeSelect
              id="kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                setLeaveId("");
                setPreview(null);
              }}
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{help}</p>
          </div>

          {(kind === "APPROVE_LEAVE" || kind === "REMOVE_LEAVE") && (
            <div className="space-y-1.5">
              <Label htmlFor="leave">{kind === "APPROVE_LEAVE" ? "Pending leave" : "Leave"}</Label>
              <NativeSelect id="leave" value={leaveId} onChange={(e) => setLeaveId(e.target.value)}>
                <option value="">Choose...</option>
                {leaveChoices.map((l) => (
                  <option key={l.id} value={l.id}>
                    {nameOf(l.employeeId)}: {dayLabel(l.fromDate)} to {dayLabel(l.toDate)} (
                    {l.status.toLowerCase()})
                  </option>
                ))}
              </NativeSelect>
              {kind === "APPROVE_LEAVE" && pending.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No pending leave. Use &ldquo;Add leave&rdquo; instead.
                </p>
              )}
            </div>
          )}

          {(kind === "ADD_LEAVE" || kind === "MAKE_UNAVAILABLE") && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="emp">Who</Label>
                <NativeSelect
                  id="emp"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="from">From</Label>
                  <Input
                    id="from"
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      if (e.target.value > to) setTo(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="to">To</Label>
                  <Input
                    id="to"
                    type="date"
                    value={to}
                    min={from}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              </div>
              {kind === "ADD_LEAVE" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ltype">Type</Label>
                  <NativeSelect
                    id="ltype"
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value as typeof leaveType)}
                  >
                    <option value="PLANNED">Planned</option>
                    <option value="SICK">Sick</option>
                    <option value="COMP_OFF">Comp-off</option>
                  </NativeSelect>
                </div>
              )}
            </>
          )}

          {(kind === "CHANGE_RULE" || kind === "CHANGE_MIN_STAFF") && (
            <div className="space-y-1.5">
              <Label htmlFor="bp">Brand / process</Label>
              <NativeSelect id="bp" value={bpId} onChange={(e) => setBpId(e.target.value)}>
                {bpOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.brandName} / {b.processCode}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          {kind === "CHANGE_RULE" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="rule">Operates</Label>
                <NativeSelect
                  id="rule"
                  value={rule}
                  onChange={(e) => setRule(e.target.value as Rule)}
                >
                  <option value="ALL_DAYS">All days, holidays too</option>
                  <option value="NO_PUBLIC_HOLIDAYS">Every day except public holidays</option>
                  <option value="NO_SUNDAY_NO_PH">Mon to Sat, no public holidays</option>
                  <option value="CUSTOM">Custom weekdays</option>
                </NativeSelect>
              </div>
              {rule === "CUSTOM" && (
                <>
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label="Operating weekdays"
                  >
                    {WEEKDAYS.map((d) => (
                      <label
                        key={d}
                        className={`cursor-pointer rounded-md border px-2 py-1 text-xs ${weekdays.includes(d) ? "border-primary bg-primary text-primary-foreground" : ""}`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={weekdays.includes(d)}
                          onChange={() =>
                            setWeekdays((w) =>
                              w.includes(d) ? w.filter((x) => x !== d) : [...w, d],
                            )
                          }
                        />
                        {d[0] + d.slice(1).toLowerCase()}
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="ph"
                      checked={phToo}
                      onCheckedChange={(c) => setPhToo(Boolean(c))}
                    />
                    <Label htmlFor="ph" className="font-normal">
                      Also operates on public holidays
                    </Label>
                  </div>
                </>
              )}
            </>
          )}

          {kind === "CHANGE_MIN_STAFF" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="defmin">New default minimum (optional)</Label>
                <Input
                  id="defmin"
                  type="number"
                  min={0}
                  max={50}
                  value={defMin}
                  onChange={(e) => setDefMin(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ovd">Override on date</Label>
                  <Input
                    id="ovd"
                    type="date"
                    value={ovDate}
                    onChange={(e) => setOvDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ovm">Minimum that day</Label>
                  <Input
                    id="ovm"
                    type="number"
                    min={0}
                    max={50}
                    value={ovMin}
                    onChange={(e) => setOvMin(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={!change || busy !== null}>
              {busy === "preview" ? "Working it out..." : "Preview"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={apply}
              disabled={!fresh || busy !== null}
            >
              {busy === "apply" ? "Applying..." : `Apply as version ${view.roster.version + 1}`}
            </Button>
          </div>
          {preview && !fresh && (
            <p className="text-xs text-muted-foreground">
              You changed the inputs: preview again before applying.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </form>

        <div className="min-w-0 space-y-6">
          {!preview && !applied && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Pick a change and press Preview to see exactly which cells and issues it would change.
            </div>
          )}
          {preview && (
            <ChangeDiff
              title="Preview: nothing is saved yet"
              data={preview}
              refs={refs}
              month={month}
            />
          )}
          {applied && (
            <div className="space-y-4">
              <p
                role="status"
                className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950"
                data-testid="applied-banner"
              >
                Applied. {monthTitle(month)} is now{" "}
                <strong>version {applied.result.roster.version}</strong> (a draft, built from
                version {applied.parent}). Version {applied.parent} is kept in history.{" "}
                {applied.result.carriedAcknowledgements > 0 &&
                  `${applied.result.carriedAcknowledgements} acknowledgement(s) carried over. `}
                {applied.result.changedSinceAcknowledged > 0 &&
                  `${applied.result.changedSinceAcknowledged} acknowledged issue(s) now read differently and need acknowledging again. `}
                <Link className="font-medium underline" href={`/roster/${month}`}>
                  Open the roster
                </Link>
              </p>
              <ChangeDiff
                title={`Version ${applied.result.roster.version} compared with version ${applied.parent}`}
                data={applied.result}
                refs={refs}
                month={month}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
