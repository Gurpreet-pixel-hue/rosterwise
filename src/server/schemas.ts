// Zod schemas for every input the server accepts. Dates are YYYY-MM-DD strings, months YYYY-MM, times
// HH:mm; nothing here ever builds a local-time Date.
import { z } from "zod";
import { weekdayOf } from "../engine/calendar";

const isRealDate = (d: string) => {
  try {
    weekdayOf(d);
    return true;
  } catch {
    return false;
  }
};

export const WeekdaySchema = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
const weekdays = z.array(WeekdaySchema).transform((a) => [...new Set(a)]);

export const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine(isRealDate, "not a real calendar date");
export const MonthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm");
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1, "required").max(120);
const note = z.string().trim().max(500).nullish();
export const actorSchema = z.string().trim().min(1).max(100).default("manager");

export const OperatingRuleSchema = z.enum([
  "ALL_DAYS",
  "NO_PUBLIC_HOLIDAYS",
  "NO_SUNDAY_NO_PH",
  "CUSTOM",
]);
export const EntryStatusSchema = z.enum([
  "WORK",
  "WEEKLY_OFF",
  "LEAVE",
  "COMP_OFF",
  "HOLIDAY",
  "UNAVAILABLE",
]);
const LeaveTypeSchema = z.enum(["PLANNED", "SICK", "COMP_OFF"]);
const LeaveStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
const weekdayMinStaff = z.partialRecord(WeekdaySchema, z.number().int().min(0).max(50));

// ---- master data (create shapes; an update merges the patch into the stored row and re-parses) ----

export const PodInput = z.object({ name, leadId: id.nullish() });

export const EmployeeInput = z.object({
  name,
  podId: id,
  isActive: z.boolean().default(true),
  weeklyOffsPerWeek: z.number().int().min(0).max(3).default(1),
  fixedOffDays: weekdays.default([]),
  preferredOffDays: weekdays.default([]),
  maxConsecutiveDays: z.number().int().min(1).max(14).default(6),
  maxDailyHours: z.number().min(1).max(16).default(9),
});

export const BrandInput = z.object({ name, podId: id });

export const ProcessInput = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Z0-9_]+$/, "use capital letters, digits and underscores"),
  name,
});

export const BrandProcessInput = z
  .object({
    brandId: id,
    processId: id,
    operatingRule: OperatingRuleSchema,
    customWeekdays: weekdays.default([]),
    worksOnPublicHolidays: z.boolean().default(false),
    defaultMinStaff: z.number().int().min(0).max(50).default(1),
    weekdayMinStaff: weekdayMinStaff.nullish(),
    shiftStart: hhmm.default("09:00"),
    shiftEnd: hhmm.default("18:00"),
  })
  .superRefine((v, ctx) => {
    if (v.operatingRule === "CUSTOM" && v.customWeekdays.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["customWeekdays"],
        message: "a CUSTOM rule needs at least one weekday",
      });
    }
    if (v.shiftStart >= v.shiftEnd) {
      ctx.addIssue({
        code: "custom",
        path: ["shiftEnd"],
        message: "shift must end after it starts (same-day shifts only)",
      });
    }
  });

export const AssignmentInput = z.object({
  employeeId: id,
  brandProcessId: id,
  role: z.enum(["PRIMARY", "BACKUP"]),
  allocationPct: z.number().int().min(1).max(100).default(100),
  note: z.string().trim().max(300).nullish(),
});

export const HolidayInput = z.object({ date: DateString, name });

export const LeaveInput = z
  .object({
    employeeId: id,
    fromDate: DateString,
    toDate: DateString,
    type: LeaveTypeSchema,
    status: LeaveStatusSchema.default("PENDING"),
    note,
  })
  .superRefine((v, ctx) => {
    if (v.fromDate > v.toDate) {
      ctx.addIssue({
        code: "custom",
        path: ["toDate"],
        message: "the leave cannot end before it starts",
      });
    }
  });

export const CompOffCreditInput = z.object({
  employeeId: id,
  earnedOn: DateString,
  reason: z.string().trim().min(1).max(300),
  usedOn: DateString.nullish(),
});

export const CoverageOverrideInput = z.object({
  brandProcessId: id,
  date: DateString,
  minStaff: z.number().int().min(0).max(50),
  reason: note,
});

// ---- roster operations ---------------------------------------------------------------------------

export const GenerateInput = z.object({
  month: MonthString,
  actor: actorSchema,
  today: DateString.optional(),
});

export const ManualEditInput = z.object({
  rosterId: id,
  employeeId: id,
  date: DateString,
  status: EntryStatusSchema,
  coveredBrandProcessIds: z.array(id).default([]),
  actor: actorSchema,
});

export const ApplySuggestionInput = z.object({
  rosterId: id,
  issueId: z.string().min(1).max(200),
  suggestionIndex: z.number().int().min(0).max(20),
  actor: actorSchema,
});

export const CompareVersionsInput = z.object({
  month: MonthString,
  from: z.number().int().min(1).max(10000),
  to: z.number().int().min(1).max(10000),
});

export const ChangeInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ADD_LEAVE"),
    leave: z
      .object({
        id: id.optional(),
        employeeId: id,
        fromDate: DateString,
        toDate: DateString,
        type: LeaveTypeSchema,
        status: LeaveStatusSchema,
      })
      .refine((l) => l.fromDate <= l.toDate, "the leave cannot end before it starts"),
  }),
  z.object({ type: z.literal("REMOVE_LEAVE"), leaveId: id }),
  z
    .object({
      type: z.literal("MAKE_UNAVAILABLE"),
      employeeId: id,
      fromDate: DateString,
      toDate: DateString,
    })
    .refine((c) => c.fromDate <= c.toDate, "the period cannot end before it starts"),
  z.object({
    type: z.literal("CHANGE_RULE"),
    brandProcessId: id,
    patch: z
      .object({
        operatingRule: OperatingRuleSchema,
        customWeekdays: weekdays,
        worksOnPublicHolidays: z.boolean(),
        shiftStart: hhmm,
        shiftEnd: hhmm,
      })
      .partial()
      .refine((p) => Object.keys(p).length > 0, "nothing to change"),
  }),
  z
    .object({
      type: z.literal("CHANGE_MIN_STAFF"),
      brandProcessId: id,
      defaultMinStaff: z.number().int().min(0).max(50).optional(),
      weekdayMinStaff: weekdayMinStaff.nullable().optional(),
      override: z
        .object({ date: DateString, minStaff: z.number().int().min(0).max(50) })
        .optional(),
    })
    .refine(
      (c) =>
        c.defaultMinStaff !== undefined ||
        c.weekdayMinStaff !== undefined ||
        c.override !== undefined,
      "nothing to change",
    ),
]);

export type ChangeInputT = z.infer<typeof ChangeInput>;

export const ApplyChangeInput = z.object({
  rosterId: id,
  change: ChangeInput,
  actor: actorSchema,
  today: DateString.optional(),
});
export const SimulateChangeInput = z.object({
  rosterId: id,
  change: ChangeInput,
  today: DateString.optional(),
});

export const AckInput = z.object({
  rosterId: id,
  issueId: id,
  note: z.string().trim().min(3, "explain why this is accepted (at least 3 characters)").max(500),
  actor: actorSchema,
});

export const PublishInput = z.object({ rosterId: id, actor: actorSchema });
