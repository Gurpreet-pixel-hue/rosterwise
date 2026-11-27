import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  authConfig,
  cleanDisplayName,
  passcodeMatches,
  signSession,
  verifySession,
} from "./session";

const SECRET = "s".repeat(40);
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);

describe("authConfig (fails closed)", () => {
  it("is configured only when both the passcode and a long-enough secret are set", () => {
    expect(authConfig({ DEMO_PASSCODE: "open sesame", SESSION_SECRET: SECRET })).toEqual({
      configured: true,
      passcode: "open sesame",
      secret: SECRET,
    });
  });

  it.each([
    ["no passcode", { SESSION_SECRET: SECRET }],
    ["an empty passcode", { DEMO_PASSCODE: "", SESSION_SECRET: SECRET }],
    ["a whitespace-only passcode", { DEMO_PASSCODE: "   ", SESSION_SECRET: SECRET }],
    ["no secret", { DEMO_PASSCODE: "open sesame" }],
    ["a secret under 32 characters", { DEMO_PASSCODE: "open sesame", SESSION_SECRET: "short" }],
  ])("is not configured with %s", (_label, env) => {
    expect(authConfig(env)).toEqual({ configured: false });
  });
});

describe("session cookie", () => {
  it("round-trips the display name", () => {
    const token = signSession({ name: "Asha", exp: NOW + SESSION_TTL_MS }, SECRET);
    expect(verifySession(token, SECRET, NOW)).toEqual({ name: "Asha", exp: NOW + SESSION_TTL_MS });
  });

  it("lasts 12 hours", () => {
    expect(SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("rejects an expired session", () => {
    const token = signSession({ name: "Asha", exp: NOW + SESSION_TTL_MS }, SECRET);
    expect(verifySession(token, SECRET, NOW + SESSION_TTL_MS)).toBeNull();
    expect(verifySession(token, SECRET, NOW + SESSION_TTL_MS - 1)).not.toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = signSession({ name: "Asha", exp: NOW + 1000 }, "x".repeat(40));
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });

  it("rejects a token whose payload was edited (name swapped, signature kept)", () => {
    const token = signSession({ name: "Asha", exp: NOW + 1000 }, SECRET);
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ name: "Admin", exp: NOW + 1000 })).toString(
      "base64url",
    );
    expect(verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects an extended expiry (exp edited, signature kept)", () => {
    const token = signSession({ name: "Asha", exp: NOW + 1000 }, SECRET);
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ name: "Asha", exp: NOW + 1e12 })).toString(
      "base64url",
    );
    expect(verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it.each(["", "abc", "a.b.c", ".", "abc.", ".abc", "💥.💥"])("rejects garbage %j", (t) => {
    expect(verifySession(t, SECRET, NOW)).toBeNull();
  });

  it("rejects a correctly signed payload that is not a session", () => {
    // Signed with the right secret but the wrong shape: still not a session.
    const payload = Buffer.from(JSON.stringify({ hello: "world" })).toString("base64url");
    const good = signSession({ name: "x", exp: NOW + 1000 }, SECRET);
    expect(verifySession(`${payload}.${good.split(".")[1]}`, SECRET, NOW)).toBeNull();
  });
});

describe("passcodeMatches", () => {
  it("accepts the exact passcode only", () => {
    expect(passcodeMatches("open sesame", "open sesame")).toBe(true);
    expect(passcodeMatches("open sesame ", "open sesame")).toBe(false);
    expect(passcodeMatches("Open sesame", "open sesame")).toBe(false);
    expect(passcodeMatches("", "open sesame")).toBe(false);
  });

  it("copes with inputs of very different length without throwing", () => {
    expect(passcodeMatches("x".repeat(100_000), "open sesame")).toBe(false);
  });
});

describe("cleanDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanDisplayName("  Asha   Rao ")).toBe("Asha Rao");
  });

  it("refuses empty, non-string and over-long names", () => {
    expect(cleanDisplayName("   ")).toBeNull();
    expect(cleanDisplayName(undefined)).toBeNull();
    expect(cleanDisplayName(42)).toBeNull();
    expect(cleanDisplayName("a".repeat(61))).toBeNull();
    expect(cleanDisplayName("a".repeat(60))).toBe("a".repeat(60));
  });

  it("refuses control characters (they would forge audit lines)", () => {
    expect(cleanDisplayName("Asha\nactor=admin")).toBeNull();
    expect(cleanDisplayName("Asha\u0000")).toBeNull();
  });
});
