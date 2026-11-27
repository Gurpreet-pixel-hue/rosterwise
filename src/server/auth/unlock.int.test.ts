// The passcode unlock and its brute-force limit, against a real Postgres (the limit lives in the database
// because in-memory counters do not survive serverless instances).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { HAS_DB, closeDb, testPrisma } from "../__tests__/helpers";
import { MAX_FAILED_ATTEMPTS, WINDOW_MS, attemptUnlock } from "./unlock";
import { verifySession } from "./session";

const SECRET = "s".repeat(40);
const ENV = { DEMO_PASSCODE: "open sesame", SESSION_SECRET: SECRET };
const NOW = new Date("2026-11-27T12:00:00Z");
const prisma = () => testPrisma();

const tryUnlock = (over: Partial<Parameters<typeof attemptUnlock>[1]> = {}) =>
  attemptUnlock(prisma(), {
    passcode: "open sesame",
    name: "Asha",
    ip: "203.0.113.7",
    env: ENV,
    now: NOW,
    ...over,
  });

describe.skipIf(!HAS_DB)("attemptUnlock", () => {
  beforeEach(async () => {
    await prisma().unlockAttempt.deleteMany();
  });
  afterAll(closeDb);

  it("unlocks with the right passcode and returns a signed session carrying the display name", async () => {
    const r = await tryUnlock();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(verifySession(r.token, SECRET, NOW.getTime())).toEqual({
      name: "Asha",
      exp: NOW.getTime() + 12 * 60 * 60 * 1000,
    });
  });

  it("refuses a wrong passcode with 401, issues no token, and records the attempt", async () => {
    const r = await tryUnlock({ passcode: "guess" });
    expect(r).toEqual({ ok: false, status: 401, message: expect.any(String) });
    expect(await prisma().unlockAttempt.count()).toBe(1);
  });

  it("refuses a missing or invalid display name with 400 and does not count it as a guess", async () => {
    expect(await tryUnlock({ name: "  " })).toMatchObject({ ok: false, status: 400 });
    expect(await tryUnlock({ name: "a\nb" })).toMatchObject({ ok: false, status: 400 });
    expect(await prisma().unlockAttempt.count()).toBe(0);
  });

  it("blocks with 429 after 5 failures, even for the right passcode", async () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++)
      expect(await tryUnlock({ passcode: `guess${i}` })).toMatchObject({ status: 401 });
    const blocked = await tryUnlock();
    expect(blocked).toMatchObject({ ok: false, status: 429 });
    // A blocked request is not itself a new failed attempt (the window must not slide forever).
    expect(await prisma().unlockAttempt.count()).toBe(MAX_FAILED_ATTEMPTS);
  });

  it("lets the same IP try again once the 15 minute window has passed", async () => {
    expect(WINDOW_MS).toBe(15 * 60 * 1000);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await tryUnlock({ passcode: "guess" });
    expect(await tryUnlock()).toMatchObject({ status: 429 });
    const later = new Date(NOW.getTime() + WINDOW_MS + 1);
    expect(await tryUnlock({ now: later })).toMatchObject({ ok: true });
  });

  it("holds the limit under concurrency: parallel wrong guesses never get more than 5 comparisons", async () => {
    // The old check-then-record order let every parallel request read "0 failures" and be compared.
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => tryUnlock({ passcode: `guess${i}` })),
    );
    const compared = results.filter((r) => !r.ok && r.status === 401).length;
    const blocked = results.filter((r) => !r.ok && r.status === 429).length;
    expect(compared).toBeLessThanOrEqual(MAX_FAILED_ATTEMPTS);
    expect(compared + blocked).toBe(30);
    expect(results.some((r) => r.ok)).toBe(false);
    // Blocked requests leave no trace, so the window does not slide while someone hammers it.
    expect(await prisma().unlockAttempt.count()).toBe(compared);
  });

  it("keeps the counters per IP", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++)
      await tryUnlock({ passcode: "guess", ip: "198.51.100.1" });
    expect(await tryUnlock({ ip: "198.51.100.1" })).toMatchObject({ status: 429 });
    expect(await tryUnlock({ ip: "198.51.100.2" })).toMatchObject({ ok: true });
  });

  it("does not store the raw IP", async () => {
    await tryUnlock({ passcode: "guess", ip: "203.0.113.7" });
    const rows = await prisma().unlockAttempt.findMany();
    expect(rows[0].ipHash).not.toContain("203.0.113.7");
    expect(rows[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("clears the IP's failures after a successful unlock", async () => {
    await tryUnlock({ passcode: "guess" });
    await tryUnlock({ passcode: "guess" });
    expect(await tryUnlock()).toMatchObject({ ok: true });
    expect(await prisma().unlockAttempt.count()).toBe(0);
  });

  it("deletes expired attempts (the table stays small)", async () => {
    await tryUnlock({ passcode: "guess" });
    await tryUnlock({ now: new Date(NOW.getTime() + WINDOW_MS + 1), passcode: "guess" });
    expect(await prisma().unlockAttempt.count()).toBe(1);
  });

  it("fails closed: with no DEMO_PASSCODE nobody can unlock, whatever they type", async () => {
    for (const passcode of ["", "open sesame", "undefined"])
      expect(await tryUnlock({ passcode, env: { SESSION_SECRET: SECRET } })).toMatchObject({
        ok: false,
        status: 503,
      });
  });

  it("fails closed: with a short SESSION_SECRET nobody can unlock", async () => {
    expect(
      await tryUnlock({ env: { DEMO_PASSCODE: "open sesame", SESSION_SECRET: "short" } }),
    ).toMatchObject({ ok: false, status: 503 });
  });
});
