import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { availabilityOf } from "../availability";
import { parseWeekdayMinStaff } from "../../server/buildEngineInput";
import { buildEngineInput } from "../../server/buildEngineInput";
import { buildSeedData } from "../../../prisma/seed-data";
import { emp, leave } from "./fixtures";

const ENGINE_DIR = join(__dirname, "..");
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sources(p);
    return p.endsWith(".ts") ? [p] : [];
  });

describe("the engine is pure (CLAUDE.md: no DB, no Next.js, no I/O, deterministic)", () => {
  const files = sources(ENGINE_DIR);

  it("finds the engine source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("imports nothing from Prisma, Next.js, the server layer, or Node I/O", () => {
    const forbidden =
      /from\s+["'](@prisma\/|next|node:|fs|path|crypto|child_process|\.\.\/server|\.\.\/\.\.\/server)/;
    for (const f of files) {
      const bad = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => forbidden.test(l));
      expect(bad, f).toEqual([]);
    }
  });

  it("has no hidden randomness or clock reads", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
    for (const f of files) {
      const text = codeOnly(readFileSync(f, "utf8"));
      expect(text, f).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date\(\)/);
      // a Date is only ever built from explicit UTC parts, and only in calendar.ts
      if (!f.endsWith("calendar.ts")) expect(text, f).not.toMatch(/new Date\(/);
    }
  });
});

describe("availabilityOf", () => {
  const a = emp("A", { fixedOffDays: ["SUN"] });
  it("only APPROVED leave counts; comp-off wins over leave; fixed off applies otherwise", () => {
    const leaves = [
      leave("A", "2026-12-09", "2026-12-10"),
      leave("A", "2026-12-10", "2026-12-10", { type: "COMP_OFF" }),
      leave("A", "2026-12-14", "2026-12-14", { status: "PENDING" }),
      leave("A", "2026-12-15", "2026-12-15", { status: "REJECTED" }),
      leave("B", "2026-12-16", "2026-12-16"),
    ];
    expect(availabilityOf(a, "2026-12-09", leaves)).toBe("LEAVE");
    expect(availabilityOf(a, "2026-12-10", leaves)).toBe("COMP_OFF");
    expect(availabilityOf(a, "2026-12-14", leaves)).toBe("AVAILABLE"); // pending
    expect(availabilityOf(a, "2026-12-15", leaves)).toBe("AVAILABLE"); // rejected
    expect(availabilityOf(a, "2026-12-16", leaves)).toBe("AVAILABLE"); // someone else's leave
    expect(availabilityOf(a, "2026-12-13", leaves)).toBe("FIXED_OFF"); // a Sunday
    // leave beats a fixed off day
    expect(availabilityOf(a, "2026-12-13", [leave("A", "2026-12-13", "2026-12-13")])).toBe("LEAVE");
  });
});

describe("buildEngineInput", () => {
  it("validates the weekdayMinStaff JSON column instead of trusting it", () => {
    expect(parseWeekdayMinStaff(null)).toBeNull();
    expect(parseWeekdayMinStaff({})).toBeNull();
    expect(parseWeekdayMinStaff({ MON: 2, SAT: 0 })).toEqual({ MON: 2, SAT: 0 });
    expect(() => parseWeekdayMinStaff({ FUNDAY: 1 })).toThrow(/unknown weekday/);
    expect(() => parseWeekdayMinStaff({ MON: -1 })).toThrow(/integer >= 0/);
    expect(() => parseWeekdayMinStaff({ MON: 1.5 })).toThrow(/integer >= 0/);
    expect(() => parseWeekdayMinStaff([1, 2])).toThrow(/object/);
    expect(() => parseWeekdayMinStaff("MON")).toThrow(/object/);
  });

  it("maps the seed into an engine input and carries the brand and process names", () => {
    const input = buildEngineInput(buildSeedData(), "2026-12");
    expect(input.employees).toHaveLength(32);
    expect(input.brandProcesses).toHaveLength(34);
    const helix = input.brandProcesses.find(
      (b) => b.brandName === "Helix Sports Nutrition" && b.processCode === "CS",
    )!;
    expect(helix.weekdayMinStaff).toEqual({ MON: 2 });
    expect(helix.operatingRule).toBe("CUSTOM");
    expect(helix.brandPodId).toBe("pod-delta");
  });

  it("rejects a brand-process that points at a missing brand", () => {
    const rows = buildSeedData();
    rows.brands = rows.brands.slice(1);
    expect(() => buildEngineInput(rows, "2026-12")).toThrow(/missing brand or process/);
  });
});
