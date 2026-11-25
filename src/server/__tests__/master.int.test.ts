// Master-data CRUD against a REAL Postgres: every resource, every refusal, and the link to rosters.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../errors";
import {
  createRecord,
  deactivateEmployee,
  deleteRecord,
  getRecord,
  listRecords,
  reactivateEmployee,
  updateRecord,
} from "../services/master";
import { acknowledgeIssue, generateMonth } from "../services/roster";
import { DEC, HAS_DB, closeDb, resetDb, testPrisma } from "./helpers";

const prisma = () => testPrisma();

async function failure(p: Promise<unknown>): Promise<ServiceError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError);
    return e as ServiceError;
  }
  throw new Error("expected the call to fail");
}

const auditCount = () => prisma().auditLog.count();
const audit = (entity: string) =>
  prisma().auditLog.findMany({ where: { entity }, orderBy: { createdAt: "asc" } });

describe.skipIf(!HAS_DB)("master data CRUD (integration, real Postgres)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(closeDb);

  // ---------------------------------------------------------------------------------------------
  describe("create, update and delete every resource, each audited", () => {
    it("process", async () => {
      const p = await createRecord(
        prisma(),
        "process",
        { code: "QA", name: "Quality Audit" },
        "ops",
      );
      expect(await getRecord(prisma(), "process", p.id)).toMatchObject({
        code: "QA",
        name: "Quality Audit",
      });
      await updateRecord(prisma(), "process", p.id, { name: "Quality Assurance" }, "ops");
      expect((await listRecords(prisma(), "process")).map((r) => r.code)).toContain("QA");
      await deleteRecord(prisma(), "process", p.id, "ops");
      expect((await audit("Process")).map((a) => a.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);
      expect(await prisma().process.findUnique({ where: { id: p.id } })).toBeNull();
    });

    it("pod, with a lead who belongs to it", async () => {
      const pod = await createRecord(prisma(), "pod", { name: "Echo" }, "ops");
      const e = await createRecord(
        prisma(),
        "employee",
        { name: "Echo Lead", podId: pod.id },
        "ops",
      );
      const withLead = await updateRecord(prisma(), "pod", pod.id, { leadId: e.id }, "ops");
      expect(withLead.leadId).toBe(e.id);
      await updateRecord(prisma(), "pod", pod.id, { name: "Echo Team" }, "ops");
      expect((await getRecord(prisma(), "pod", pod.id)).leadId).toBe(e.id); // the merge kept the lead
    });

    it("employee: defaults are applied, weekdays de-duplicated, deactivate and reactivate", async () => {
      const e = await createRecord(
        prisma(),
        "employee",
        { name: "Test Person", podId: "pod-alpha" },
        "ops",
      );
      expect(e).toMatchObject({
        isActive: true,
        weeklyOffsPerWeek: 1,
        maxConsecutiveDays: 6,
        maxDailyHours: 9,
        fixedOffDays: [],
        preferredOffDays: [],
      });
      const u = await updateRecord(
        prisma(),
        "employee",
        e.id,
        { preferredOffDays: ["SAT", "SAT", "SUN"], weeklyOffsPerWeek: 2 },
        "ops",
      );
      expect(u).toMatchObject({
        preferredOffDays: ["SAT", "SUN"],
        weeklyOffsPerWeek: 2,
        name: "Test Person",
      });
      expect((await deactivateEmployee(prisma(), e.id, "ops")).isActive).toBe(false);
      expect((await reactivateEmployee(prisma(), e.id, "ops")).isActive).toBe(true);
      await deleteRecord(prisma(), "employee", e.id, "ops"); // never rostered, so it may go
      expect((await audit("Employee")).map((a) => a.action)).toEqual([
        "CREATE",
        "UPDATE",
        "UPDATE",
        "UPDATE",
        "DELETE",
      ]);
    });

    it("brand, brand-process (rule, weekday minimums, shift), assignment, override", async () => {
      const brand = await createRecord(
        prisma(),
        "brand",
        { name: "Test Brand", podId: "pod-alpha" },
        "ops",
      );
      const bp = await createRecord(
        prisma(),
        "brandProcess",
        { brandId: brand.id, processId: "proc-cs", operatingRule: "ALL_DAYS" },
        "ops",
      );
      expect(bp).toMatchObject({
        shiftStart: "09:00",
        shiftEnd: "18:00",
        defaultMinStaff: 1,
        worksOnPublicHolidays: false,
        customWeekdays: [],
      });
      const custom = await updateRecord(
        prisma(),
        "brandProcess",
        bp.id,
        { operatingRule: "CUSTOM", customWeekdays: ["MON", "TUE"], weekdayMinStaff: { MON: 2 } },
        "ops",
      );
      expect(custom).toMatchObject({
        operatingRule: "CUSTOM",
        customWeekdays: ["MON", "TUE"],
        weekdayMinStaff: { MON: 2 },
      });
      const cleared = await updateRecord(
        prisma(),
        "brandProcess",
        bp.id,
        { weekdayMinStaff: null },
        "ops",
      );
      expect(cleared.weekdayMinStaff).toBeNull();

      const person = await createRecord(
        prisma(),
        "employee",
        { name: "Assignee", podId: "pod-alpha" },
        "ops",
      );
      const a = await createRecord(
        prisma(),
        "assignment",
        { employeeId: person.id, brandProcessId: bp.id, role: "PRIMARY" },
        "ops",
      );
      expect(a.allocationPct).toBe(100);
      expect(
        await updateRecord(
          prisma(),
          "assignment",
          a.id,
          { allocationPct: 60, role: "BACKUP" },
          "ops",
        ),
      ).toMatchObject({ allocationPct: 60, role: "BACKUP" });
      const o = await createRecord(
        prisma(),
        "coverageOverride",
        { brandProcessId: bp.id, date: "2026-12-14", minStaff: 2, reason: "sale" },
        "ops",
      );
      expect(
        (await updateRecord(prisma(), "coverageOverride", o.id, { minStaff: 3 }, "ops")).minStaff,
      ).toBe(3);

      await deleteRecord(prisma(), "coverageOverride", o.id, "ops");
      await deleteRecord(prisma(), "assignment", a.id, "ops");
      await deleteRecord(prisma(), "brandProcess", bp.id, "ops");
      await deleteRecord(prisma(), "brand", brand.id, "ops");
      expect((await audit("BrandProcess")).map((x) => x.action)).toEqual([
        "CREATE",
        "UPDATE",
        "UPDATE",
        "DELETE",
      ]);
    });

    it("holiday, leave, comp-off credit", async () => {
      const h = await createRecord(
        prisma(),
        "holiday",
        { date: "2027-02-14", name: "Test Day" },
        "ops",
      );
      await updateRecord(prisma(), "holiday", h.id, { name: "Renamed Day" }, "ops");
      const l = await createRecord(
        prisma(),
        "leave",
        {
          employeeId: "emp-aarav-sharma",
          fromDate: "2027-02-01",
          toDate: "2027-02-03",
          type: "PLANNED",
        },
        "ops",
      );
      expect(l.status).toBe("PENDING");
      expect(
        (await updateRecord(prisma(), "leave", l.id, { status: "APPROVED" }, "ops")).status,
      ).toBe("APPROVED");
      const c = await createRecord(
        prisma(),
        "compOffCredit",
        { employeeId: "emp-aarav-sharma", earnedOn: "2027-02-07", reason: "Worked Sunday" },
        "ops",
      );
      expect(
        (await updateRecord(prisma(), "compOffCredit", c.id, { usedOn: "2027-02-10" }, "ops"))
          .usedOn,
      ).toBe("2027-02-10");
      for (const [r, id] of [
        ["compOffCredit", c.id],
        ["leave", l.id],
        ["holiday", h.id],
      ] as const)
        await deleteRecord(prisma(), r, id, "ops");
      expect((await audit("Leave")).map((x) => x.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);
    });

    it("every audit row carries who, what, and the before and after", async () => {
      const p = await createRecord(
        prisma(),
        "process",
        { code: "QA", name: "Quality Audit" },
        "ops",
      );
      await updateRecord(prisma(), "process", p.id, { name: "Quality Assurance" }, "ops");
      await deleteRecord(prisma(), "process", p.id, "ops");
      const [c, u, d] = await audit("Process");
      expect(c).toMatchObject({ actor: "ops", action: "CREATE", entityId: p.id, before: null });
      expect(c.after).toMatchObject({ code: "QA", name: "Quality Audit" });
      expect(u.before).toMatchObject({ name: "Quality Audit" });
      expect(u.after).toMatchObject({ name: "Quality Assurance" });
      expect(d.before).toMatchObject({ name: "Quality Assurance" });
      expect(d.after).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("validation (Zod) refuses bad input and saves nothing", () => {
    const BAD: Array<[string, Record<string, unknown>, string]> = [
      ["employee", { name: "", podId: "pod-alpha" }, "name"],
      ["employee", { name: "X", podId: "pod-alpha", weeklyOffsPerWeek: 9 }, "weeklyOffsPerWeek"],
      ["employee", { name: "X", podId: "pod-alpha", fixedOffDays: ["FUNDAY"] }, "fixedOffDays"],
      ["employee", { name: "X", podId: "pod-alpha", maxDailyHours: 0 }, "maxDailyHours"],
      [
        "employee",
        { name: "X", podId: "pod-alpha", maxConsecutiveDays: 1.5 },
        "maxConsecutiveDays",
      ],
      ["process", { code: "qa", name: "Quality" }, "code"],
      ["process", { code: "", name: "Quality" }, "code"],
      [
        "brandProcess",
        { brandId: "brand-pixel-pets", processId: "proc-ret", operatingRule: "CUSTOM" },
        "customWeekdays",
      ],
      [
        "brandProcess",
        {
          brandId: "brand-pixel-pets",
          processId: "proc-ret",
          operatingRule: "ALL_DAYS",
          shiftStart: "18:00",
          shiftEnd: "09:00",
        },
        "shiftEnd",
      ],
      [
        "brandProcess",
        {
          brandId: "brand-pixel-pets",
          processId: "proc-ret",
          operatingRule: "ALL_DAYS",
          shiftStart: "9am",
        },
        "shiftStart",
      ],
      [
        "brandProcess",
        {
          brandId: "brand-pixel-pets",
          processId: "proc-ret",
          operatingRule: "ALL_DAYS",
          defaultMinStaff: -1,
        },
        "defaultMinStaff",
      ],
      [
        "brandProcess",
        {
          brandId: "brand-pixel-pets",
          processId: "proc-ret",
          operatingRule: "ALL_DAYS",
          weekdayMinStaff: { FUNDAY: 2 },
        },
        "weekdayMinStaff",
      ],
      [
        "assignment",
        {
          employeeId: "emp-aarav-sharma",
          brandProcessId: "bp-pixel-pets-cs",
          role: "PRIMARY",
          allocationPct: 0,
        },
        "allocationPct",
      ],
      [
        "assignment",
        {
          employeeId: "emp-aarav-sharma",
          brandProcessId: "bp-pixel-pets-cs",
          role: "PRIMARY",
          allocationPct: 101,
        },
        "allocationPct",
      ],
      [
        "assignment",
        { employeeId: "emp-aarav-sharma", brandProcessId: "bp-pixel-pets-cs", role: "CAPTAIN" },
        "role",
      ],
      ["holiday", { date: "2026-02-30", name: "Impossible Day" }, "date"],
      ["holiday", { date: "25/12/2026", name: "Wrong Format" }, "date"],
      [
        "leave",
        {
          employeeId: "emp-aarav-sharma",
          fromDate: "2026-12-10",
          toDate: "2026-12-09",
          type: "PLANNED",
        },
        "toDate",
      ],
      [
        "leave",
        {
          employeeId: "emp-aarav-sharma",
          fromDate: "2026-12-10",
          toDate: "2026-12-10",
          type: "HOLIDAY",
        },
        "type",
      ],
      [
        "coverageOverride",
        { brandProcessId: "bp-pixel-pets-cs", date: "2026-12-10", minStaff: -2 },
        "minStaff",
      ],
      [
        "compOffCredit",
        { employeeId: "emp-aarav-sharma", earnedOn: "2026-12-10", reason: "" },
        "reason",
      ],
    ];

    it.each(BAD)("%s %j is refused (%s)", async (resource, input, field) => {
      const before = await auditCount();
      const e = await failure(createRecord(prisma(), resource, input, "ops"));
      expect(e.code).toBe("VALIDATION");
      expect(e.message).toContain(field);
      expect(await auditCount()).toBe(before);
    });

    it("an update is checked against the WHOLE merged row, so cross-field rules still hold", async () => {
      // Pixel Pets CS is NO_SUNDAY_NO_PH with no custom weekdays: switching it to CUSTOM alone is invalid
      expect(
        (
          await failure(
            updateRecord(prisma(), "brandProcess", "bp-pixel-pets-cs", { operatingRule: "CUSTOM" }),
          )
        ).message,
      ).toContain("customWeekdays");
      // moving only the end of the shift before its start
      expect(
        (
          await failure(
            updateRecord(prisma(), "brandProcess", "bp-pixel-pets-cs", { shiftEnd: "08:00" }),
          )
        ).message,
      ).toContain("shiftEnd");
      // moving only the end date of a leave before its start
      const leave = await prisma().leave.findFirstOrThrow({
        where: { employeeId: "emp-arjun-nambiar" },
      });
      expect(
        (await failure(updateRecord(prisma(), "leave", leave.id, { toDate: "2026-12-01" })))
          .message,
      ).toContain("toDate");
      // and the stored rows are untouched
      expect(
        (await prisma().brandProcess.findUniqueOrThrow({ where: { id: "bp-pixel-pets-cs" } }))
          .operatingRule,
      ).toBe("NO_SUNDAY_NO_PH");
    });

    it("unknown fields, unknown resources, missing rows and a blank actor are refused", async () => {
      expect(
        (await failure(updateRecord(prisma(), "employee", "emp-aarav-sharma", { nickname: "A" })))
          .message,
      ).toContain("Unknown field(s)");
      expect(
        (await failure(updateRecord(prisma(), "employee", "emp-aarav-sharma", "not an object")))
          .code,
      ).toBe("VALIDATION");
      expect((await failure(createRecord(prisma(), "spaceship", {}))).message).toContain(
        "Unknown resource",
      );
      expect(
        (await failure(updateRecord(prisma(), "employee", "emp-nobody", { name: "X" }))).code,
      ).toBe("NOT_FOUND");
      expect((await failure(deleteRecord(prisma(), "employee", "emp-nobody"))).code).toBe(
        "NOT_FOUND",
      );
      expect((await failure(getRecord(prisma(), "employee", "emp-nobody"))).code).toBe("NOT_FOUND");
      expect(
        (await failure(createRecord(prisma(), "process", { code: "QA", name: "Quality" }, "  ")))
          .code,
      ).toBe("VALIDATION");
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("references and uniqueness", () => {
    it("rows that point at nothing are refused", async () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        ["employee", { name: "X", podId: "pod-nope" }],
        ["brand", { name: "Ghost Brand", podId: "pod-nope" }],
        [
          "brandProcess",
          { brandId: "brand-nope", processId: "proc-cs", operatingRule: "ALL_DAYS" },
        ],
        [
          "brandProcess",
          { brandId: "brand-pixel-pets", processId: "proc-nope", operatingRule: "ALL_DAYS" },
        ],
        [
          "assignment",
          { employeeId: "emp-nobody", brandProcessId: "bp-pixel-pets-cs", role: "BACKUP" },
        ],
        [
          "assignment",
          { employeeId: "emp-aarav-sharma", brandProcessId: "bp-nope", role: "BACKUP" },
        ],
        [
          "leave",
          {
            employeeId: "emp-nobody",
            fromDate: "2026-12-10",
            toDate: "2026-12-10",
            type: "PLANNED",
          },
        ],
        ["coverageOverride", { brandProcessId: "bp-nope", date: "2026-12-10", minStaff: 2 }],
        ["compOffCredit", { employeeId: "emp-nobody", earnedOn: "2026-12-10", reason: "x" }],
      ];
      for (const [r, input] of cases)
        expect(
          (await failure(createRecord(prisma(), r, input))).code,
          `${r} ${JSON.stringify(input)}`,
        ).toBe("VALIDATION");
      expect(
        (
          await failure(
            createRecord(prisma(), "compOffCredit", {
              employeeId: "emp-aarav-sharma",
              earnedOn: "2026-12-10",
              usedOn: "2026-12-01",
              reason: "x",
            }),
          )
        ).message,
      ).toContain("before it was earned");
    });

    it("duplicates are CONFLICTs", async () => {
      const dup: Array<[string, Record<string, unknown>]> = [
        ["brand", { name: "Pixel Pets", podId: "pod-alpha" }],
        ["process", { code: "CS", name: "Another Support" }],
        ["holiday", { date: "2026-12-25", name: "Christmas again" }],
        [
          "assignment",
          {
            employeeId: "emp-aarav-sharma",
            brandProcessId: "bp-lumen-skincare-cs",
            role: "BACKUP",
          },
        ],
        [
          "brandProcess",
          { brandId: "brand-pixel-pets", processId: "proc-cs", operatingRule: "ALL_DAYS" },
        ],
        ["pod", { name: "Alpha" }],
        [
          "coverageOverride",
          { brandProcessId: "bp-harvest-snacks-cs", date: "2026-12-12", minStaff: 2 },
        ],
      ];
      for (const [r, input] of dup)
        expect((await failure(createRecord(prisma(), r, input))).code, r).toBe("CONFLICT");
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("pods and leads", () => {
    it("a lead must belong to the pod; a pod cannot be created with one; a lead cannot move away", async () => {
      expect(
        (await failure(createRecord(prisma(), "pod", { name: "Echo", leadId: "emp-aarav-sharma" })))
          .code,
      ).toBe("VALIDATION");
      expect(
        (await failure(updateRecord(prisma(), "pod", "pod-alpha", { leadId: "emp-kabir-singh" })))
          .message,
      ).toContain("belongs to another pod");
      expect(
        (await failure(updateRecord(prisma(), "pod", "pod-alpha", { leadId: "emp-nobody" }))).code,
      ).toBe("VALIDATION");
      // Nisha Kapoor leads Alpha, so she cannot be moved to Bravo, and cannot be deleted
      expect(
        (
          await failure(
            updateRecord(prisma(), "employee", "emp-nisha-kapoor", { podId: "pod-bravo" }),
          )
        ).message,
      ).toContain("lead the Alpha pod".replace("lead", "lead"));
      expect(
        (await failure(deleteRecord(prisma(), "employee", "emp-nisha-kapoor"))).message,
      ).toContain("lead");
      expect((await getRecord(prisma(), "employee", "emp-nisha-kapoor")).podId).toBe("pod-alpha");
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("deletes are guarded", () => {
    it("a pod with people or brands, a brand with processes, and a process in use cannot be deleted", async () => {
      expect((await failure(deleteRecord(prisma(), "pod", "pod-alpha"))).code).toBe("CONFLICT");
      expect(
        (await failure(deleteRecord(prisma(), "brand", "brand-pixel-pets"))).message,
      ).toContain("process");
      expect((await failure(deleteRecord(prisma(), "process", "proc-cs"))).code).toBe("CONFLICT");
      expect(await prisma().pod.count()).toBe(4);
    });

    it("deleting a brand-process removes its assignments and overrides with it, and says so in the audit", async () => {
      const assignments = await prisma().assignment.count({
        where: { brandProcessId: "bp-harvest-snacks-cs" },
      });
      expect(assignments).toBeGreaterThan(0);
      await deleteRecord(prisma(), "brandProcess", "bp-harvest-snacks-cs", "ops");
      expect(
        await prisma().assignment.count({ where: { brandProcessId: "bp-harvest-snacks-cs" } }),
      ).toBe(0);
      expect(
        await prisma().coverageOverride.count({
          where: { brandProcessId: "bp-harvest-snacks-cs" },
        }),
      ).toBe(0);
      expect((await audit("BrandProcess"))[0]).toMatchObject({
        action: "DELETE",
        entityId: "bp-harvest-snacks-cs",
      });
    });

    it("an employee who appears in a saved roster cannot be deleted, only deactivated, and keeps their history", async () => {
      const v1 = await generateMonth(prisma(), { month: DEC, actor: "ops" });
      const e = await failure(deleteRecord(prisma(), "employee", "emp-zoya-ansari"));
      expect(e.code).toBe("CONFLICT");
      expect(e.message).toContain("Deactivate");
      expect(
        await prisma().rosterEntry.count({
          where: { rosterId: v1.roster.id, employeeId: "emp-zoya-ansari" },
        }),
      ).toBe(35);

      await deactivateEmployee(prisma(), "emp-zoya-ansari", "ops");
      // new rosters leave her out; the old one still has her
      const v2 = await generateMonth(prisma(), { month: DEC, actor: "ops" });
      expect(await prisma().rosterEntry.count({ where: { rosterId: v2.roster.id } })).toBe(31 * 35);
      expect(
        await prisma().rosterEntry.count({
          where: { rosterId: v2.roster.id, employeeId: "emp-zoya-ansari" },
        }),
      ).toBe(0);
      expect(
        await prisma().rosterEntry.count({
          where: { rosterId: v1.roster.id, employeeId: "emp-zoya-ansari" },
        }),
      ).toBe(35);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("a manager can change staffing without touching code", () => {
    it("adding a backup for Nimbus Gadgets through assignments, then regenerating, clears Ananya's errors", async () => {
      const before = await generateMonth(prisma(), { month: DEC, actor: "ops" });
      expect(before.issues.filter((i) => i.severity === "ERROR")).toHaveLength(5);

      // Rohan Mehta (Bravo pod lead, no assignments) becomes the backup for both Nimbus Gadgets processes
      await createRecord(
        prisma(),
        "assignment",
        {
          employeeId: "emp-rohan-mehta",
          brandProcessId: "bp-nimbus-gadgets-cs",
          role: "BACKUP",
          allocationPct: 60,
        },
        "ops",
      );
      await createRecord(
        prisma(),
        "assignment",
        {
          employeeId: "emp-rohan-mehta",
          brandProcessId: "bp-nimbus-gadgets-ndr",
          role: "BACKUP",
          allocationPct: 40,
        },
        "ops",
      );
      const after = await generateMonth(prisma(), { month: DEC, actor: "ops" });

      expect(after.roster.version).toBe(2);
      expect(after.issues.filter((i) => i.severity === "ERROR")).toEqual([]);
      // and with no ERRORs left, nothing needs acknowledging: the new version could be published as is
      expect(after.carriedAcknowledgements).toBe(0);
      void acknowledgeIssue; // (publishing without acknowledgements is covered in roster.int.test.ts)
    });

    it("adding a new employee puts them in the next roster", async () => {
      const e = await createRecord(
        prisma(),
        "employee",
        { name: "New Joiner", podId: "pod-charlie" },
        "ops",
      );
      const v = await generateMonth(prisma(), { month: DEC, actor: "ops" });
      expect(
        await prisma().rosterEntry.count({ where: { rosterId: v.roster.id, employeeId: e.id } }),
      ).toBe(35);
      expect(await prisma().rosterEntry.count({ where: { rosterId: v.roster.id } })).toBe(33 * 35);
    });
  });
});
