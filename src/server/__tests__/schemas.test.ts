// Pure unit tests (no database) for the Zod schemas and the error helpers.
import { describe, expect, it } from "vitest";
import { ServiceError, parse, toResult } from "../errors";
import {
  AckInput,
  BrandProcessInput,
  ChangeInput,
  DateString,
  EmployeeInput,
  GenerateInput,
  LeaveInput,
  MonthString,
} from "../schemas";

describe("date, month and time formats", () => {
  it("accepts real dates and refuses impossible or mis-formatted ones", () => {
    for (const ok of ["2026-12-31", "2028-02-29", "2027-01-01"])
      expect(DateString.safeParse(ok).success).toBe(true);
    for (const bad of [
      "2026-02-30",
      "2027-02-29",
      "2026-13-01",
      "26-12-01",
      "2026-1-1",
      "",
      "2026-12-01T00:00:00Z",
    ]) {
      expect(DateString.safeParse(bad).success, bad).toBe(false);
    }
    expect(MonthString.safeParse("2026-12").success).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-1", "December"])
      expect(MonthString.safeParse(bad).success, bad).toBe(false);
  });
});

describe("employee", () => {
  it("fills defaults and removes duplicate weekdays", () => {
    const e = EmployeeInput.parse({ name: "  A  ", podId: "p", preferredOffDays: ["SAT", "SAT"] });
    expect(e).toMatchObject({
      name: "A",
      isActive: true,
      weeklyOffsPerWeek: 1,
      maxConsecutiveDays: 6,
      maxDailyHours: 9,
      fixedOffDays: [],
      preferredOffDays: ["SAT"],
    });
  });
});

describe("brand-process", () => {
  const base = { brandId: "b", processId: "p", operatingRule: "ALL_DAYS" as const };
  it("needs weekdays for CUSTOM, a forward shift, and valid weekday minimums", () => {
    expect(BrandProcessInput.safeParse({ ...base, operatingRule: "CUSTOM" }).success).toBe(false);
    expect(
      BrandProcessInput.safeParse({ ...base, operatingRule: "CUSTOM", customWeekdays: ["MON"] })
        .success,
    ).toBe(true);
    expect(
      BrandProcessInput.safeParse({ ...base, shiftStart: "10:00", shiftEnd: "10:00" }).success,
    ).toBe(false);
    expect(
      BrandProcessInput.safeParse({ ...base, weekdayMinStaff: { MON: 2, SAT: 0 } }).success,
    ).toBe(true);
    expect(BrandProcessInput.safeParse({ ...base, weekdayMinStaff: { MON: 2.5 } }).success).toBe(
      false,
    );
    expect(BrandProcessInput.safeParse({ ...base, weekdayMinStaff: null }).success).toBe(true);
  });
});

describe("leave", () => {
  it("cannot end before it starts, and defaults to PENDING", () => {
    const ok = LeaveInput.parse({
      employeeId: "e",
      fromDate: "2026-12-01",
      toDate: "2026-12-01",
      type: "SICK",
    });
    expect(ok.status).toBe("PENDING");
    expect(
      LeaveInput.safeParse({
        employeeId: "e",
        fromDate: "2026-12-02",
        toDate: "2026-12-01",
        type: "SICK",
      }).success,
    ).toBe(false);
  });
});

describe("roster inputs", () => {
  it("generate defaults the actor", () => {
    expect(GenerateInput.parse({ month: "2026-12" }).actor).toBe("manager");
  });

  it("an acknowledgement needs a real note", () => {
    const base = { rosterId: "r", issueId: "i" };
    expect(AckInput.safeParse({ ...base, note: "ok" }).success).toBe(false);
    expect(AckInput.safeParse({ ...base, note: "   " }).success).toBe(false);
    expect(AckInput.parse({ ...base, note: "  accepted: no backup  " }).note).toBe(
      "accepted: no backup",
    );
  });

  it("changes are a tagged union, each validated", () => {
    const leave = {
      employeeId: "e",
      fromDate: "2026-12-01",
      toDate: "2026-12-02",
      type: "PLANNED",
      status: "APPROVED",
    };
    expect(ChangeInput.safeParse({ type: "ADD_LEAVE", leave }).success).toBe(true);
    expect(
      ChangeInput.safeParse({ type: "ADD_LEAVE", leave: { ...leave, toDate: "2026-11-30" } })
        .success,
    ).toBe(false);
    expect(ChangeInput.safeParse({ type: "REMOVE_LEAVE" }).success).toBe(false);
    expect(
      ChangeInput.safeParse({ type: "CHANGE_RULE", brandProcessId: "b", patch: {} }).success,
    ).toBe(false);
    expect(
      ChangeInput.safeParse({
        type: "CHANGE_RULE",
        brandProcessId: "b",
        patch: { operatingRule: "ALL_DAYS" },
      }).success,
    ).toBe(true);
    expect(ChangeInput.safeParse({ type: "CHANGE_MIN_STAFF", brandProcessId: "b" }).success).toBe(
      false,
    );
    expect(
      ChangeInput.safeParse({
        type: "CHANGE_MIN_STAFF",
        brandProcessId: "b",
        override: { date: "2026-12-12", minStaff: 2 },
      }).success,
    ).toBe(true);
    expect(ChangeInput.safeParse({ type: "TELEPORT" }).success).toBe(false);
  });
});

describe("error helpers", () => {
  it("parse() lists every problem with its field, as a VALIDATION error", () => {
    try {
      parse(EmployeeInput, { name: "", podId: "p", weeklyOffsPerWeek: 9 }, "employee");
      throw new Error("should not get here");
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError);
      const err = e as ServiceError;
      expect(err.code).toBe("VALIDATION");
      expect(err.message).toContain("Invalid employee");
      expect(err.message).toContain("name");
      expect(err.message).toContain("weeklyOffsPerWeek");
      expect((err.details as unknown[]).length).toBe(2);
    }
  });

  it("toResult() turns expected failures into plain data and hides unexpected ones", async () => {
    const ok = await toResult(async () => 42);
    expect(ok).toEqual({ ok: true, data: 42 });
    const expected = await toResult(async () => {
      throw new ServiceError("BLOCKED", "no", [1]);
    });
    expect(expected).toEqual({
      ok: false,
      error: { code: "BLOCKED", message: "no", details: [1] },
    });
    const unexpected = await toResult(async () => {
      throw new Error("secret stack detail");
    });
    expect(unexpected.ok).toBe(false);
    if (!unexpected.ok) {
      expect(unexpected.error.code).toBe("INTERNAL");
      expect(unexpected.error.message).not.toContain("secret");
    }
  });
});
