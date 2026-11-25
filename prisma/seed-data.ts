// Pure seed data (no DB, no Prisma runtime import) so the same data can be written by
// prisma/seed.ts and checked by scripts/seed-checks.ts, including in CI without Postgres.
//
// Everything here is fictional: names, brands, pods and the holiday calendar.
// The deliberate demo scenarios (CLAUDE.md section 5) are described in docs/DEMO_SCRIPT.md.

export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type OperatingRule = "ALL_DAYS" | "NO_PUBLIC_HOLIDAYS" | "NO_SUNDAY_NO_PH" | "CUSTOM";
export type AssignmentRole = "PRIMARY" | "BACKUP";
export type LeaveType = "PLANNED" | "SICK" | "COMP_OFF";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface PodRow {
  id: string;
  name: string;
  leadId: string;
}
export interface EmployeeRow {
  id: string;
  name: string;
  podId: string;
  isActive: boolean;
  weeklyOffsPerWeek: number;
  fixedOffDays: Weekday[];
  preferredOffDays: Weekday[];
  maxConsecutiveDays: number;
  maxDailyHours: number;
}
export interface BrandRow {
  id: string;
  name: string;
  podId: string;
}
export interface ProcessRow {
  id: string;
  code: string;
  name: string;
}
export interface BrandProcessRow {
  id: string;
  brandId: string;
  processId: string;
  operatingRule: OperatingRule;
  customWeekdays: Weekday[];
  worksOnPublicHolidays: boolean;
  defaultMinStaff: number;
  weekdayMinStaff: Partial<Record<Weekday, number>> | null;
  shiftStart: string;
  shiftEnd: string;
}
export interface AssignmentRow {
  id: string;
  employeeId: string;
  brandProcessId: string;
  role: AssignmentRole;
  allocationPct: number;
}
export interface PublicHolidayRow {
  id: string;
  date: string;
  name: string;
}
export interface LeaveRow {
  id: string;
  employeeId: string;
  fromDate: string;
  toDate: string;
  type: LeaveType;
  status: LeaveStatus;
  note: string | null;
}
export interface CompOffCreditRow {
  id: string;
  employeeId: string;
  earnedOn: string;
  reason: string;
  usedOn: string | null;
}
export interface CoverageOverrideRow {
  id: string;
  brandProcessId: string;
  date: string;
  minStaff: number;
  reason: string | null;
}

/** Everything the seed writes, as plain rows. The shape the checks run on. */
export interface SeedSnapshot {
  pods: PodRow[];
  employees: EmployeeRow[];
  brands: BrandRow[];
  processes: ProcessRow[];
  brandProcesses: BrandProcessRow[];
  assignments: AssignmentRow[];
  holidays: PublicHolidayRow[];
  leaves: LeaveRow[];
  compOffCredits: CompOffCreditRow[];
  coverageOverrides: CoverageOverrideRow[];
}

// ---------------------------------------------------------------------------------------------
// Pods and employees
// ---------------------------------------------------------------------------------------------

const PODS = [
  { key: "alpha", name: "Alpha", lead: "Nisha Kapoor" },
  { key: "bravo", name: "Bravo", lead: "Rohan Mehta" },
  { key: "charlie", name: "Charlie", lead: "Priya Nair" },
  { key: "delta", name: "Delta", lead: "Karan Malhotra" },
] as const;
type PodKey = (typeof PODS)[number]["key"];

interface EmployeeSpec {
  name: string;
  pod: PodKey;
  fixed?: Weekday[];
  preferred?: Weekday[];
  weeklyOffs?: number;
  maxConsecutive?: number;
}

// 32 employees. 22 hold a PRIMARY assignment; 10 are bench/support staff who only back others up
// (Rohan Mehta, a pod lead, deliberately has no assignment at all).
const EMPLOYEES: EmployeeSpec[] = [
  // Alpha (9)
  { name: "Nisha Kapoor", pod: "alpha", preferred: ["SUN"] },
  { name: "Aarav Sharma", pod: "alpha", preferred: ["SUN"] },
  { name: "Ishita Verma", pod: "alpha", preferred: ["SAT", "SUN"] },
  { name: "Vikram Rao", pod: "alpha", preferred: ["MON"] },
  { name: "Meera Iyer", pod: "alpha", preferred: ["SUN"] },
  { name: "Sanjay Patil", pod: "alpha", preferred: ["WED"] },
  { name: "Divya Menon", pod: "alpha" },
  { name: "Rahul Bhatt", pod: "alpha", preferred: ["SAT"] },
  { name: "Tanvi Joshi", pod: "alpha" },
  // Bravo (8)
  { name: "Rohan Mehta", pod: "bravo" },
  { name: "Ananya Reddy", pod: "bravo", preferred: ["SUN"] },
  { name: "Kabir Singh", pod: "bravo", fixed: ["SUN"] },
  { name: "Pooja Desai", pod: "bravo", preferred: ["SUN"] },
  { name: "Arjun Nambiar", pod: "bravo", preferred: ["FRI"] },
  { name: "Sneha Kulkarni", pod: "bravo", preferred: ["TUE"] },
  { name: "Manish Gupta", pod: "bravo" },
  { name: "Farhan Qureshi", pod: "bravo", preferred: ["SAT"] },
  // Charlie (7)
  { name: "Priya Nair", pod: "charlie", preferred: ["SUN"] },
  { name: "Dev Choudhary", pod: "charlie" },
  { name: "Shruti Banerjee", pod: "charlie", preferred: ["MON"] },
  { name: "Imran Sheikh", pod: "charlie", preferred: ["SUN"] },
  { name: "Kavya Hegde", pod: "charlie", preferred: ["THU"] },
  { name: "Nikhil Agarwal", pod: "charlie", preferred: ["SUN"] },
  { name: "Rekha Das", pod: "charlie", preferred: ["SAT", "SUN"] },
  // Delta (8)
  { name: "Karan Malhotra", pod: "delta" },
  { name: "Aditi Saxena", pod: "delta", preferred: ["SUN"] },
  { name: "Gaurav Chopra", pod: "delta", preferred: ["SUN"] },
  { name: "Harleen Kaur", pod: "delta", preferred: ["TUE"] },
  { name: "Siddharth Jain", pod: "delta", fixed: ["SUN"] },
  { name: "Neha Bansal", pod: "delta", preferred: ["WED"] },
  { name: "Omkar Kadam", pod: "delta", preferred: ["SUN"] },
  { name: "Zoya Ansari", pod: "delta" },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const podId = (key: PodKey) => `pod-${key}`;
const empId = (name: string) => `emp-${slug(name)}`;
const brandId = (name: string) => `brand-${slug(name)}`;
const procId = (code: string) => `proc-${code.toLowerCase()}`;
const bpId = (brand: string, code: string) => `bp-${slug(brand)}-${code.toLowerCase()}`;

// ---------------------------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------------------------

const PROCESSES = [
  { code: "CS", name: "Customer Support" },
  { code: "ACC", name: "Abandoned Cart Conversion" },
  { code: "NDR", name: "Non-Delivery Report Management" },
  { code: "RET", name: "Retention" },
  { code: "COD", name: "COD Verification" },
];

// ---------------------------------------------------------------------------------------------
// Brands, brand-processes and assignments
// ---------------------------------------------------------------------------------------------

type ProcessCode = "CS" | "ACC" | "NDR" | "RET" | "COD";

const SHIFT = {
  DAY: ["09:00", "18:00"],
  EARLY: ["06:00", "15:00"],
  MIDDAY: ["12:00", "21:00"],
  EVENING: ["14:00", "23:00"],
} as const;
type ShiftKey = keyof typeof SHIFT;

interface BpSpec {
  code: ProcessCode;
  rule: OperatingRule;
  shift?: ShiftKey;
  min?: number;
  weekdayMin?: Partial<Record<Weekday, number>>;
  customWeekdays?: Weekday[];
  worksOnPH?: boolean;
  /** [employee name, allocationPct] */
  primary: Array<[string, number]>;
  backup?: Array<[string, number]>;
}
interface BrandSpec {
  name: string;
  pod: PodKey;
  bps: BpSpec[];
}

const BRANDS: BrandSpec[] = [
  // --- Aarav Sharma covers three single-resource brands, all closed on Sundays/PHs, no backups.
  //     His leave is what produces the CASCADE_GAP demo (scenario 4).
  {
    name: "Lumen Skincare",
    pod: "alpha",
    bps: [
      { code: "CS", rule: "NO_SUNDAY_NO_PH", primary: [["Aarav Sharma", 30]] },
      { code: "ACC", rule: "NO_SUNDAY_NO_PH", primary: [["Aarav Sharma", 20]] },
    ],
  },
  {
    name: "Verdant Tea Co",
    pod: "alpha",
    bps: [{ code: "CS", rule: "NO_SUNDAY_NO_PH", primary: [["Aarav Sharma", 25]] }],
  },
  {
    name: "Atlas Footwear",
    pod: "alpha",
    bps: [{ code: "CS", rule: "NO_SUNDAY_NO_PH", primary: [["Aarav Sharma", 25]] }],
  },

  // --- Kabir Singh: two brands. Fixed Sunday off, so Manish Gupta must cover Pebble Toys on Sundays.
  {
    name: "Orchid Home",
    pod: "bravo",
    bps: [
      { code: "CS", rule: "NO_SUNDAY_NO_PH", primary: [["Kabir Singh", 40]] },
      { code: "ACC", rule: "NO_SUNDAY_NO_PH", primary: [["Kabir Singh", 20]] },
    ],
  },
  {
    name: "Pebble Toys",
    pod: "bravo",
    bps: [
      {
        code: "CS",
        rule: "NO_PUBLIC_HOLIDAYS",
        primary: [["Kabir Singh", 20]],
        backup: [["Manish Gupta", 50]],
      },
      {
        code: "NDR",
        rule: "NO_PUBLIC_HOLIDAYS",
        primary: [["Kabir Singh", 20]],
        backup: [["Manish Gupta", 50]],
      },
    ],
  },

  // --- Imran Sheikh: two brands on the same midday shift, Dev Choudhary backs up both.
  {
    name: "Zephyr Apparel",
    pod: "charlie",
    bps: [
      {
        code: "CS",
        rule: "ALL_DAYS",
        shift: "MIDDAY",
        primary: [["Imran Sheikh", 50]],
        backup: [["Dev Choudhary", 50]],
      },
    ],
  },
  {
    name: "Mango Mobiles",
    pod: "charlie",
    bps: [
      {
        code: "CS",
        rule: "NO_SUNDAY_NO_PH",
        shift: "MIDDAY",
        primary: [["Imran Sheikh", 50]],
        backup: [["Dev Choudhary", 50]],
      },
    ],
  },

  // --- Gaurav Chopra (Delta): two brands, one owned by another pod (cross-pod staffing).
  {
    name: "Pixel Pets",
    pod: "delta",
    bps: [{ code: "CS", rule: "NO_SUNDAY_NO_PH", primary: [["Gaurav Chopra", 40]] }],
  },
  {
    name: "Terra Organics",
    pod: "bravo",
    bps: [
      {
        code: "CS",
        rule: "NO_PUBLIC_HOLIDAYS",
        primary: [["Gaurav Chopra", 60]],
        backup: [["Farhan Qureshi", 60]],
      },
    ],
  },

  // --- One-employee-per-brand brands (a pod lead is primary on two of them).
  {
    name: "Saffron and Salt",
    pod: "alpha",
    bps: [
      {
        code: "CS",
        rule: "NO_PUBLIC_HOLIDAYS",
        primary: [["Nisha Kapoor", 60]],
        backup: [["Rahul Bhatt", 60]],
      },
      {
        code: "RET",
        rule: "NO_SUNDAY_NO_PH",
        primary: [["Nisha Kapoor", 40]],
        backup: [["Rahul Bhatt", 40]],
      },
    ],
  },
  {
    name: "Indigo Denim",
    pod: "charlie",
    bps: [
      { code: "CS", rule: "NO_SUNDAY_NO_PH", primary: [["Priya Nair", 70]] },
      { code: "RET", rule: "NO_SUNDAY_NO_PH", primary: [["Priya Nair", 30]] },
    ],
  },

  // SCENARIO 1: single-resource ALL_DAYS brand WITH a backup (resolves cleanly).
  {
    name: "Coastal Candles",
    pod: "alpha",
    bps: [
      {
        code: "CS",
        rule: "ALL_DAYS",
        primary: [["Ishita Verma", 60]],
        backup: [["Divya Menon", 60]],
      },
      {
        code: "ACC",
        rule: "NO_PUBLIC_HOLIDAYS",
        primary: [["Ishita Verma", 40]],
        backup: [["Divya Menon", 40]],
      },
    ],
  },
  // SCENARIO 2: single-resource ALL_DAYS brand WITHOUT any backup (raises a clear conflict).
  {
    name: "Nimbus Gadgets",
    pod: "bravo",
    bps: [
      { code: "CS", rule: "ALL_DAYS", primary: [["Ananya Reddy", 60]] },
      { code: "NDR", rule: "ALL_DAYS", primary: [["Ananya Reddy", 40]] },
    ],
  },
  {
    // Sale day: CoverageOverride below asks for 2 on 2026-12-12; Rekha Das is the second person.
    name: "Harvest Snacks",
    pod: "charlie",
    bps: [
      {
        code: "CS",
        rule: "NO_PUBLIC_HOLIDAYS",
        primary: [["Shruti Banerjee", 60]],
        backup: [["Rekha Das", 60]],
      },
      {
        code: "ACC",
        rule: "NO_PUBLIC_HOLIDAYS",
        primary: [["Shruti Banerjee", 40]],
        backup: [["Rekha Das", 40]],
      },
    ],
  },
  {
    name: "Quartz Jewellery",
    pod: "delta",
    bps: [
      {
        code: "CS",
        rule: "NO_SUNDAY_NO_PH",
        shift: "EVENING",
        primary: [["Aditi Saxena", 60]],
        backup: [["Zoya Ansari", 60]],
      },
      {
        code: "ACC",
        rule: "NO_SUNDAY_NO_PH",
        shift: "EVENING",
        primary: [["Aditi Saxena", 40]],
        backup: [["Zoya Ansari", 40]],
      },
    ],
  },
  {
    // Early shift, 365 days; a pod lead (Karan Malhotra) is the backup.
    name: "Urban Brew Coffee",
    pod: "delta",
    bps: [
      {
        code: "CS",
        rule: "ALL_DAYS",
        shift: "EARLY",
        primary: [["Harleen Kaur", 60]],
        backup: [["Karan Malhotra", 60]],
      },
      {
        code: "NDR",
        rule: "NO_PUBLIC_HOLIDAYS",
        shift: "EARLY",
        primary: [["Harleen Kaur", 40]],
        backup: [["Karan Malhotra", 40]],
      },
    ],
  },

  // --- Multi-resource brands -------------------------------------------------------------------
  // Three people, one process each (separate processes per person) plus cross-cover.
  {
    name: "Nova Wellness",
    pod: "alpha",
    bps: [
      {
        code: "CS",
        rule: "ALL_DAYS",
        primary: [["Vikram Rao", 70]],
        backup: [
          ["Meera Iyer", 30],
          ["Tanvi Joshi", 50],
        ],
      },
      {
        code: "ACC",
        rule: "NO_SUNDAY_NO_PH",
        primary: [["Meera Iyer", 70]],
        backup: [["Sanjay Patil", 30]],
      },
      {
        code: "NDR",
        rule: "NO_PUBLIC_HOLIDAYS",
        primary: [["Sanjay Patil", 70]],
        backup: [["Tanvi Joshi", 50]],
      },
    ],
  },
  // SCENARIO 3: three people share ONE process, min 2 every day, no backup.
  //   Arjun's leave (16-17 Dec) is absorbable. A second simultaneous leave is not.
  {
    name: "Orbit Electronics",
    pod: "bravo",
    bps: [
      {
        code: "CS",
        rule: "ALL_DAYS",
        min: 2,
        primary: [
          ["Pooja Desai", 100],
          ["Arjun Nambiar", 100],
          ["Sneha Kulkarni", 100],
        ],
      },
    ],
  },
  // CS runs 365 days while ACC is closed on Sundays and PHs; the two people cross-cover.
  {
    name: "Cedar and Co Furniture",
    pod: "charlie",
    bps: [
      {
        code: "CS",
        rule: "ALL_DAYS",
        primary: [["Kavya Hegde", 70]],
        backup: [["Nikhil Agarwal", 30]],
      },
      {
        code: "ACC",
        rule: "NO_SUNDAY_NO_PH",
        primary: [["Nikhil Agarwal", 70]],
        backup: [["Kavya Hegde", 30]],
      },
    ],
  },
  // CUSTOM rule (Mon-Sat), two people share CS (Monday needs 2), a third owns COD verification.
  {
    name: "Helix Sports Nutrition",
    pod: "delta",
    bps: [
      {
        code: "CS",
        rule: "CUSTOM",
        customWeekdays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
        worksOnPH: false,
        min: 1,
        weekdayMin: { MON: 2 },
        primary: [
          ["Siddharth Jain", 100],
          ["Neha Bansal", 70],
        ],
      },
      {
        code: "COD",
        rule: "NO_PUBLIC_HOLIDAYS",
        primary: [["Omkar Kadam", 100]],
        backup: [["Neha Bansal", 30]],
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Calendar, leave and overrides. Demo months are December 2026 and January 2027.
// ---------------------------------------------------------------------------------------------

const HOLIDAYS: Array<[string, string]> = [
  ["2026-12-06", "Regional Winter Festival"], // a Sunday: public holiday on a Sunday
  ["2026-12-25", "Christmas Day"],
  ["2027-01-01", "New Year's Day"],
  ["2027-01-14", "Makar Sankranti"],
  ["2027-01-26", "Republic Day"],
];

const LEAVES: Array<{
  employee: string;
  from: string;
  to: string;
  type: LeaveType;
  status: LeaveStatus;
  note?: string;
}> = [
  // SCENARIO 3: one of three sharing CS is away; the other two absorb it.
  {
    employee: "Arjun Nambiar",
    from: "2026-12-16",
    to: "2026-12-17",
    type: "PLANNED",
    status: "APPROVED",
    note: "Family function",
  },
  // SCENARIO 1: the single employee is away three days; the backup covers.
  {
    employee: "Ishita Verma",
    from: "2026-12-21",
    to: "2026-12-23",
    type: "PLANNED",
    status: "APPROVED",
    note: "Travel",
  },
  {
    employee: "Kavya Hegde",
    from: "2026-12-07",
    to: "2026-12-07",
    type: "SICK",
    status: "APPROVED",
  },
  {
    employee: "Imran Sheikh",
    from: "2026-12-09",
    to: "2026-12-09",
    type: "PLANNED",
    status: "APPROVED",
  },
  // Approved comp-off in December (uses the credit below).
  {
    employee: "Aditi Saxena",
    from: "2026-12-11",
    to: "2026-12-11",
    type: "COMP_OFF",
    status: "APPROVED",
    note: "Comp-off for working Sunday 22 Nov",
  },
  // Leave that spans the month boundary and includes a public holiday (1 Jan).
  {
    employee: "Harleen Kaur",
    from: "2026-12-30",
    to: "2027-01-02",
    type: "PLANNED",
    status: "APPROVED",
    note: "New Year trip",
  },
  // SCENARIO 4: the single PENDING leave. Not applied to the roster until approved.
  //   Aarav is the only cover for three brands, so approving it causes a CASCADE_GAP.
  {
    employee: "Aarav Sharma",
    from: "2026-12-29",
    to: "2026-12-30",
    type: "PLANNED",
    status: "PENDING",
    note: "Requested, awaiting manager",
  },
  // A rejected request: must never affect the roster.
  {
    employee: "Vikram Rao",
    from: "2026-12-24",
    to: "2026-12-26",
    type: "PLANNED",
    status: "REJECTED",
    note: "Rejected: Christmas coverage",
  },
  // January 2027.
  {
    employee: "Meera Iyer",
    from: "2027-01-12",
    to: "2027-01-13",
    type: "PLANNED",
    status: "APPROVED",
  },
  {
    employee: "Sneha Kulkarni",
    from: "2027-01-20",
    to: "2027-01-20",
    type: "SICK",
    status: "APPROVED",
  },
  {
    employee: "Neha Bansal",
    from: "2027-01-25",
    to: "2027-01-27",
    type: "PLANNED",
    status: "APPROVED",
    note: "Spans Republic Day",
  },
];

const COMP_OFF_CREDITS: Array<{
  employee: string;
  earnedOn: string;
  reason: string;
  usedOn: string | null;
}> = [
  {
    employee: "Aditi Saxena",
    earnedOn: "2026-11-22",
    reason: "Worked Sunday during the festive sale",
    usedOn: "2026-12-11",
  },
  {
    employee: "Pooja Desai",
    earnedOn: "2026-11-29",
    reason: "Worked weekly-off day to cover a colleague",
    usedOn: null,
  },
];

const COVERAGE_OVERRIDES: Array<{
  brand: string;
  code: ProcessCode;
  date: string;
  minStaff: number;
  reason: string;
}> = [
  {
    brand: "Harvest Snacks",
    code: "CS",
    date: "2026-12-12",
    minStaff: 2,
    reason: "12.12 sale day",
  },
  {
    brand: "Orbit Electronics",
    code: "CS",
    date: "2027-01-15",
    minStaff: 3,
    reason: "Winter sale launch: everyone in",
  },
];

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

function mustEmp(name: string): string {
  const spec = EMPLOYEES.find((e) => e.name === name);
  if (!spec) throw new Error(`Seed refers to unknown employee "${name}"`);
  return empId(name);
}

export function buildSeedData(): SeedSnapshot {
  const pods: PodRow[] = PODS.map((p) => ({
    id: podId(p.key),
    name: p.name,
    leadId: mustEmp(p.lead),
  }));

  const employees: EmployeeRow[] = EMPLOYEES.map((e) => ({
    id: empId(e.name),
    name: e.name,
    podId: podId(e.pod),
    isActive: true,
    weeklyOffsPerWeek: e.weeklyOffs ?? 1,
    fixedOffDays: e.fixed ?? [],
    preferredOffDays: e.preferred ?? [],
    maxConsecutiveDays: e.maxConsecutive ?? 6,
    maxDailyHours: 9,
  }));

  const processes: ProcessRow[] = PROCESSES.map((p) => ({
    id: procId(p.code),
    code: p.code,
    name: p.name,
  }));

  const brands: BrandRow[] = [];
  const brandProcesses: BrandProcessRow[] = [];
  const assignments: AssignmentRow[] = [];

  for (const b of BRANDS) {
    brands.push({ id: brandId(b.name), name: b.name, podId: podId(b.pod) });
    for (const bp of b.bps) {
      const id = bpId(b.name, bp.code);
      const [shiftStart, shiftEnd] = SHIFT[bp.shift ?? "DAY"];
      brandProcesses.push({
        id,
        brandId: brandId(b.name),
        processId: procId(bp.code),
        operatingRule: bp.rule,
        customWeekdays: bp.customWeekdays ?? [],
        worksOnPublicHolidays: bp.worksOnPH ?? false,
        defaultMinStaff: bp.min ?? 1,
        weekdayMinStaff: bp.weekdayMin ?? null,
        shiftStart,
        shiftEnd,
      });
      for (const [name, pct] of bp.primary) {
        assignments.push({
          id: `asg-${empId(name)}-${id}`,
          employeeId: mustEmp(name),
          brandProcessId: id,
          role: "PRIMARY",
          allocationPct: pct,
        });
      }
      for (const [name, pct] of bp.backup ?? []) {
        assignments.push({
          id: `asg-${empId(name)}-${id}`,
          employeeId: mustEmp(name),
          brandProcessId: id,
          role: "BACKUP",
          allocationPct: pct,
        });
      }
    }
  }

  const bpIdFor = (brand: string, code: ProcessCode) => {
    const id = bpId(brand, code);
    if (!brandProcesses.some((bp) => bp.id === id)) {
      throw new Error(`Seed refers to unknown brand-process "${brand}" / ${code}`);
    }
    return id;
  };

  return {
    pods,
    employees,
    brands,
    processes,
    brandProcesses,
    assignments,
    holidays: HOLIDAYS.map(([date, name]) => ({ id: `ph-${date}`, date, name })),
    leaves: LEAVES.map((l, i) => ({
      id: `leave-${String(i + 1).padStart(2, "0")}-${empId(l.employee)}`,
      employeeId: mustEmp(l.employee),
      fromDate: l.from,
      toDate: l.to,
      type: l.type,
      status: l.status,
      note: l.note ?? null,
    })),
    compOffCredits: COMP_OFF_CREDITS.map((c, i) => ({
      id: `credit-${String(i + 1).padStart(2, "0")}-${empId(c.employee)}`,
      employeeId: mustEmp(c.employee),
      earnedOn: c.earnedOn,
      reason: c.reason,
      usedOn: c.usedOn,
    })),
    coverageOverrides: COVERAGE_OVERRIDES.map((o) => ({
      id: `override-${slug(o.brand)}-${o.code.toLowerCase()}-${o.date}`,
      brandProcessId: bpIdFor(o.brand, o.code),
      date: o.date,
      minStaff: o.minStaff,
      reason: o.reason,
    })),
  };
}

/**
 * The four deliberate demo scenarios (CLAUDE.md section 5). Names refer to rows built above.
 * scripts/seed-checks.ts asserts each one still has the structure it needs, and
 * docs/DEMO_SCRIPT.md walks through them.
 */
export const DEMO_SCENARIOS = {
  /** 1. Single-resource ALL_DAYS brand WITH a backup: the primary's weekly offs and leave resolve cleanly. */
  singleWithBackup: { brand: "Coastal Candles", primary: "Ishita Verma", backup: "Divya Menon" },
  /** 2. Single-resource ALL_DAYS brand WITHOUT a backup: raises a clear conflict. */
  singleNoBackup: { brand: "Nimbus Gadgets", primary: "Ananya Reddy" },
  /** 3. Three people share one process (min 2): one leave is absorbable, a second simultaneous one is not. */
  threePersonBrand: {
    brand: "Orbit Electronics",
    process: "CS",
    absorbedLeave: "Arjun Nambiar",
    people: ["Pooja Desai", "Arjun Nambiar", "Sneha Kulkarni"],
  },
  /** 4. Multi-brand employee: their (pending) leave causes CASCADE_GAP across all three brands. */
  cascade: {
    employee: "Aarav Sharma",
    brands: ["Lumen Skincare", "Verdant Tea Co", "Atlas Footwear"],
  },
} as const;
