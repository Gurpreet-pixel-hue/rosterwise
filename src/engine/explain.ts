// Deterministic, human-readable explanations. The optional AI explanation (P5) falls back to this
// text when there is no API key, and never needs more than the data used here.
import { weekdayOf } from "./calendar";
import type { EngineBrandProcess, EngineInput, Issue } from "./types";

const label = (bp: EngineBrandProcess) => `${bp.brandName} / ${bp.processCode}`;

export function explainIssue(issue: Issue, input: EngineInput): string {
  const emp = issue.employeeId ? input.employees.find((e) => e.id === issue.employeeId) : undefined;
  const bp = issue.brandProcessId
    ? input.brandProcesses.find((b) => b.id === issue.brandProcessId)
    : undefined;
  const nameOf = (id: string) => input.employees.find((e) => e.id === id)?.name ?? id;
  const bpById = (id: string) => input.brandProcesses.find((b) => b.id === id);
  const assignees = (bpId: string) => input.assignments.filter((a) => a.brandProcessId === bpId);
  const alone = (employeeId: string) =>
    input.assignments
      .filter((a) => a.employeeId === employeeId && a.role === "PRIMARY")
      .map((a) => bpById(a.brandProcessId))
      .filter(
        (b): b is EngineBrandProcess =>
          !!b && assignees(b.id).filter((a) => a.employeeId !== employeeId).length === 0,
      );
  const fix =
    issue.suggestions.length > 0
      ? ` Options: ${issue.suggestions.map((s) => s.description).join(" | ")}`
      : "";
  const when = issue.date ? ` on ${issue.date} (${weekdayOf(issue.date)})` : "";

  switch (issue.code) {
    case "COVERAGE_GAP": {
      const staff = bp
        ? assignees(bp.id)
            .map((a) => `${nameOf(a.employeeId)} (${a.role.toLowerCase()})`)
            .join(", ")
        : "";
      const backups = bp ? assignees(bp.id).filter((a) => a.role === "BACKUP").length : 0;
      return `${issue.message} Client coverage is mandatory, so this is an error rather than a preference. Assigned: ${staff}. ${
        backups === 0
          ? "There is no backup for this process."
          : `${backups} backup(s) exist but none is free.`
      }${fix}`;
    }
    case "NO_ELIGIBLE_STAFF":
      return `${issue.message} Nobody can ever cover it, so no roster can be valid until someone is assigned in the master data.`;
    case "WEEKLY_OFF_NOT_GRANTED": {
      const sole = emp ? alone(emp.id) : [];
      return `${issue.message} A weekly off is a labour rule that must never be hidden, but granting it must not leave a client uncovered, and coverage wins. ${
        sole.length > 0
          ? `${emp!.name} is the only assigned person for ${sole.map(label).join(", ")}, so any day off would leave ${sole.length === 1 ? "it" : "them"} unstaffed. `
          : ""
      }A manager has to decide: add a backup, approve a temporary assignment, or accept the gap with a note.${fix}`;
    }
    case "CASCADE_GAP":
      return `${issue.message} One person's absence${when} affects several client accounts at once, so it is grouped into a single issue.${fix}`;
    case "WORK_WHILE_UNAVAILABLE":
      return `${issue.message} The approved leave or comp-off must be respected; change the entry, or revoke the leave first.`;
    case "FIXED_OFF_VIOLATED":
      return `${issue.message} A contract-fixed off day is a hard constraint, unlike a preferred off day.`;
    case "SHIFT_INCOMPATIBLE":
      return `${issue.message} One person cannot work these shifts on the same day; cover one of them with someone else.`;
    case "OVERALLOCATED":
      return `${issue.message} It is a warning: it does not break coverage but the person is over capacity.`;
    case "PREFERRED_OFF_NOT_HONOURED":
      return `${issue.message} This is a preference, not a rule, and it was overridden on purpose because coverage is mandatory.`;
    case "CONSECUTIVE_DAYS_EXCEEDED":
      return `${issue.message} Consider moving a weekly off to break the run.`;
    case "PENDING_LEAVE_CONFLICT":
      return `${issue.message} The leave is still pending, so the roster does not apply it yet. Plan cover before approving.`;
    case "COMP_OFF_EARNED":
      return `${issue.message} No action needed; the credit can be redeemed later as a comp-off.`;
  }
}
