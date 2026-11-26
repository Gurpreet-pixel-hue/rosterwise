// What each master-data page shows and edits. Plain data (plus small render functions) so one generic manager
// serves all ten resources; the rules themselves live in the server's services, not here.
export type FieldType =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "ref"
  | "weekdays"
  | "weekdayMin"
  | "time"
  | "date"
  | "textarea";

export type Row = Record<string, unknown> & { id: string };
/** `lookups[kind][id]` -> a readable label, for showing a reference as a name. */
export type Lookups = Record<string, Record<string, string>>;

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  options?: Array<{ value: string; label: string }>;
  /** For type "ref": which lookup list supplies the choices. */
  ref?: string;
  help?: string;
  min?: number;
  max?: number;
  /** Optional fields send nothing (or null) when left empty. */
  optional?: boolean;
  /** Hide the field unless another field has one of these values. */
  showWhen?: { field: string; in: string[] };
}

export interface Column {
  label: string;
  value: (row: Row, lookups: Lookups) => string;
}

export interface ResourceDef {
  slug: string;
  /** The service's resource name. */
  resource: string;
  title: string;
  singular: string;
  description: string;
  columns: Column[];
  fields: Field[];
  defaults: Record<string, unknown>;
}

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const text = (key: string) => (r: Row) => String(r[key] ?? "");
const yesNo = (v: unknown) => (v ? "Yes" : "No");
const list = (v: unknown) => (Array.isArray(v) && v.length > 0 ? v.join(", ") : "none");
const lookup = (kind: string, key: string) => (r: Row, l: Lookups) =>
  l[kind]?.[String(r[key])] ?? String(r[key] ?? "");

const RULES = [
  { value: "ALL_DAYS", label: "All days (365, Sundays and holidays too)" },
  { value: "NO_PUBLIC_HOLIDAYS", label: "Every day except public holidays" },
  { value: "NO_SUNDAY_NO_PH", label: "Mon to Sat, no public holidays" },
  { value: "CUSTOM", label: "Custom weekdays" },
];
const RULE_SHORT: Record<string, string> = {
  ALL_DAYS: "All days",
  NO_PUBLIC_HOLIDAYS: "No holidays",
  NO_SUNDAY_NO_PH: "Mon-Sat, no holidays",
  CUSTOM: "Custom",
};

function minStaffSummary(r: Row): string {
  const base = `${r.defaultMinStaff} default`;
  const w = r.weekdayMinStaff as Record<string, number> | null | undefined;
  const extra = w
    ? WEEKDAYS.filter((d) => w[d] !== undefined).map(
        (d) => `${d[0]}${d.slice(1).toLowerCase()} ${w[d]}`,
      )
    : [];
  return extra.length > 0 ? `${base}; ${extra.join(", ")}` : base;
}

export const RESOURCE_DEFS: ResourceDef[] = [
  {
    slug: "employees",
    resource: "employee",
    title: "Employees",
    singular: "employee",
    description:
      "Who can be rostered. A fixed off day is a contract rule (hard); a preferred off day is a wish (soft). People are deactivated, never deleted, once they appear in a roster.",
    columns: [
      { label: "Name", value: text("name") },
      { label: "Pod", value: lookup("pod", "podId") },
      { label: "Active", value: (r) => yesNo(r.isActive) },
      { label: "Fixed off", value: (r) => list(r.fixedOffDays) },
      { label: "Preferred off", value: (r) => list(r.preferredOffDays) },
      { label: "Max in a row", value: text("maxConsecutiveDays") },
    ],
    fields: [
      { name: "name", label: "Name", type: "text" },
      { name: "podId", label: "Pod", type: "ref", ref: "pod" },
      { name: "isActive", label: "Active", type: "checkbox" },
      { name: "weeklyOffsPerWeek", label: "Weekly offs per week", type: "number", min: 0, max: 3 },
      { name: "fixedOffDays", label: "Fixed off days (contract, hard)", type: "weekdays" },
      { name: "preferredOffDays", label: "Preferred off days (soft)", type: "weekdays" },
      { name: "maxConsecutiveDays", label: "Max days in a row", type: "number", min: 1, max: 14 },
      { name: "maxDailyHours", label: "Max hours per day", type: "number", min: 1, max: 16 },
    ],
    defaults: {
      isActive: true,
      weeklyOffsPerWeek: 1,
      fixedOffDays: [],
      preferredOffDays: [],
      maxConsecutiveDays: 6,
      maxDailyHours: 9,
    },
  },
  {
    slug: "pods",
    resource: "pod",
    title: "Pods",
    singular: "pod",
    description: "Teams of employees. A pod lead is also an employee, and can be a backup.",
    columns: [
      { label: "Name", value: text("name") },
      {
        label: "Lead",
        value: (r, l) => (r.leadId ? (l.employee?.[String(r.leadId)] ?? "") : "none yet"),
      },
    ],
    fields: [
      { name: "name", label: "Name", type: "text" },
      {
        name: "leadId",
        label: "Lead",
        type: "ref",
        ref: "employee",
        optional: true,
        help: "Add the pod's employees first, then choose a lead by editing the pod.",
      },
    ],
    defaults: {},
  },
  {
    slug: "brands",
    resource: "brand",
    title: "Brands",
    singular: "brand",
    description:
      "The clients. Each brand belongs to a pod, but employees from any pod can still cover it.",
    columns: [
      { label: "Name", value: text("name") },
      { label: "Owning pod", value: lookup("pod", "podId") },
    ],
    fields: [
      { name: "name", label: "Name", type: "text" },
      { name: "podId", label: "Owning pod", type: "ref", ref: "pod" },
    ],
    defaults: {},
  },
  {
    slug: "processes",
    resource: "process",
    title: "Processes",
    singular: "process",
    description: "The catalog of kinds of work: CS, ACC, NDR, RET and brand-specific ones.",
    columns: [
      { label: "Code", value: text("code") },
      { label: "Name", value: text("name") },
    ],
    fields: [
      {
        name: "code",
        label: "Code",
        type: "text",
        help: "Capital letters, digits and underscores, e.g. COD_VERIFY.",
      },
      { name: "name", label: "Name", type: "text" },
    ],
    defaults: {},
  },
  {
    slug: "brand-processes",
    resource: "brandProcess",
    title: "Brand rules",
    singular: "brand rule",
    description:
      "The demand side: when a brand's process operates, how many people it needs, and its shift. This is the brand's calendar, kept apart from anyone's schedule.",
    columns: [
      { label: "Brand", value: (r, l) => l.brandName?.[String(r.brandId)] ?? "" },
      { label: "Process", value: (r, l) => l.processCode?.[String(r.processId)] ?? "" },
      {
        label: "Operates",
        value: (r) =>
          r.operatingRule === "CUSTOM"
            ? `${list(r.customWeekdays)}${r.worksOnPublicHolidays ? " + holidays" : ""}`
            : (RULE_SHORT[String(r.operatingRule)] ?? String(r.operatingRule)),
      },
      { label: "Min staff", value: minStaffSummary },
      { label: "Shift", value: (r) => `${r.shiftStart}-${r.shiftEnd}` },
    ],
    fields: [
      { name: "brandId", label: "Brand", type: "ref", ref: "brandName" },
      { name: "processId", label: "Process", type: "ref", ref: "processCode" },
      { name: "operatingRule", label: "Operating rule", type: "select", options: RULES },
      {
        name: "customWeekdays",
        label: "Operating weekdays",
        type: "weekdays",
        showWhen: { field: "operatingRule", in: ["CUSTOM"] },
      },
      {
        name: "worksOnPublicHolidays",
        label: "Operates on public holidays",
        type: "checkbox",
        showWhen: { field: "operatingRule", in: ["CUSTOM"] },
      },
      {
        name: "defaultMinStaff",
        label: "Minimum staff (default)",
        type: "number",
        min: 0,
        max: 50,
      },
      {
        name: "weekdayMinStaff",
        label: "Minimum staff on specific weekdays",
        type: "weekdayMin",
        optional: true,
        help: "Leave a weekday blank to use the default, for example CS needs 2 on Mondays.",
      },
      { name: "shiftStart", label: "Shift starts", type: "time" },
      { name: "shiftEnd", label: "Shift ends", type: "time" },
    ],
    defaults: {
      operatingRule: "NO_SUNDAY_NO_PH",
      customWeekdays: [],
      worksOnPublicHolidays: false,
      defaultMinStaff: 1,
      shiftStart: "09:00",
      shiftEnd: "18:00",
    },
  },
  {
    slug: "assignments",
    resource: "assignment",
    title: "Assignments",
    singular: "assignment",
    description:
      "Who CAN cover which brand rule: a primary owner or a backup, and what share of their day it takes. The engine moves people between these within the rules.",
    columns: [
      { label: "Employee", value: lookup("employee", "employeeId") },
      { label: "Brand / process", value: lookup("brandProcess", "brandProcessId") },
      { label: "Role", value: text("role") },
      { label: "Allocation", value: (r) => `${r.allocationPct}%` },
    ],
    fields: [
      { name: "employeeId", label: "Employee", type: "ref", ref: "employee" },
      { name: "brandProcessId", label: "Brand / process", type: "ref", ref: "brandProcess" },
      {
        name: "role",
        label: "Role",
        type: "select",
        options: [
          { value: "PRIMARY", label: "Primary" },
          { value: "BACKUP", label: "Backup" },
        ],
      },
      {
        name: "allocationPct",
        label: "Allocation (% of the day)",
        type: "number",
        min: 1,
        max: 100,
      },
    ],
    defaults: { role: "PRIMARY", allocationPct: 100 },
  },
  {
    slug: "holidays",
    resource: "holiday",
    title: "Public holidays",
    singular: "holiday",
    description:
      "Dates that brands on a holiday rule do not operate, and the rest of the team gets off.",
    columns: [
      { label: "Date", value: text("date") },
      { label: "Name", value: text("name") },
    ],
    fields: [
      { name: "date", label: "Date", type: "date" },
      { name: "name", label: "Name", type: "text" },
    ],
    defaults: {},
  },
  {
    slug: "leaves",
    resource: "leave",
    title: "Leave",
    singular: "leave",
    description:
      "Only APPROVED leave takes someone out of the roster. PENDING leave is shown as a warning chip and is not applied until approved.",
    columns: [
      { label: "Employee", value: lookup("employee", "employeeId") },
      { label: "From", value: text("fromDate") },
      { label: "To", value: text("toDate") },
      { label: "Type", value: text("type") },
      { label: "Status", value: text("status") },
    ],
    fields: [
      { name: "employeeId", label: "Employee", type: "ref", ref: "employee" },
      { name: "fromDate", label: "From", type: "date" },
      { name: "toDate", label: "To", type: "date" },
      {
        name: "type",
        label: "Type",
        type: "select",
        options: [
          { value: "PLANNED", label: "Planned" },
          { value: "SICK", label: "Sick" },
          { value: "COMP_OFF", label: "Comp-off" },
        ],
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "PENDING", label: "Pending" },
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
        ],
      },
      { name: "note", label: "Note", type: "text", optional: true },
    ],
    defaults: { type: "PLANNED", status: "PENDING" },
  },
  {
    slug: "comp-offs",
    resource: "compOffCredit",
    title: "Comp-off credits",
    singular: "comp-off credit",
    description:
      "Time off earned for working a public holiday or weekly off. Publishing a roster adds credits for holidays worked; you can also record one by hand.",
    columns: [
      { label: "Employee", value: lookup("employee", "employeeId") },
      { label: "Earned on", value: text("earnedOn") },
      { label: "Reason", value: text("reason") },
      { label: "Used on", value: (r) => String(r.usedOn ?? "not used yet") },
    ],
    fields: [
      { name: "employeeId", label: "Employee", type: "ref", ref: "employee" },
      { name: "earnedOn", label: "Earned on", type: "date" },
      { name: "reason", label: "Reason", type: "text" },
      { name: "usedOn", label: "Used on", type: "date", optional: true },
    ],
    defaults: {},
  },
  {
    slug: "overrides",
    resource: "coverageOverride",
    title: "Coverage overrides",
    singular: "override",
    description:
      "A minimum staffing level for one brand rule on one date, for example a sale day needing 2. It wins over the weekday and default minimums.",
    columns: [
      { label: "Brand / process", value: lookup("brandProcess", "brandProcessId") },
      { label: "Date", value: text("date") },
      { label: "Minimum staff", value: text("minStaff") },
      { label: "Reason", value: (r) => String(r.reason ?? "") },
    ],
    fields: [
      { name: "brandProcessId", label: "Brand / process", type: "ref", ref: "brandProcess" },
      { name: "date", label: "Date", type: "date" },
      { name: "minStaff", label: "Minimum staff that day", type: "number", min: 0, max: 50 },
      { name: "reason", label: "Reason", type: "text", optional: true },
    ],
    defaults: { minStaff: 2 },
  },
];

export const defBySlug = (slug: string) => RESOURCE_DEFS.find((d) => d.slug === slug);
