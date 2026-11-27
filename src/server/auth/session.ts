// The shared-passcode session: an HMAC-signed cookie carrying a display name and an expiry.
// Pure functions (no Next.js, no DB) so they are easy to test. Everything here fails closed.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "rw_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_NAME_LENGTH = 60;
const MIN_SECRET_LENGTH = 32;
// C0/C1 control characters plus the Unicode line and paragraph separators.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");

export interface Session {
  name: string;
  /** Expiry, ms since the epoch. */
  exp: number;
}

export type AuthConfig =
  { configured: true; passcode: string; secret: string } | { configured: false };

type Env = Record<string, string | undefined>;

/** Both DEMO_PASSCODE and a SESSION_SECRET of 32+ characters must be set; otherwise nobody can unlock. */
export function authConfig(env: Env = process.env): AuthConfig {
  const passcode = env.DEMO_PASSCODE;
  const secret = env.SESSION_SECRET;
  if (!passcode || !passcode.trim() || !secret || secret.length < MIN_SECRET_LENGTH)
    return { configured: false };
  return { configured: true, passcode, secret };
}

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("base64url");

export function signSession(s: Session, secret: string): string {
  const body = Buffer.from(JSON.stringify({ name: s.name, exp: s.exp })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** The session if the token is authentic and unexpired, else null. Never throws. */
export function verifySession(token: string, secret: string, now: number): Session | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p !== "object" || p === null) return null;
    const { name, exp } = p as Record<string, unknown>;
    if (typeof name !== "string" || typeof exp !== "number" || !Number.isFinite(exp)) return null;
    if (cleanDisplayName(name) !== name) return null;
    if (exp <= now) return null;
    return { name, exp };
  } catch {
    return null;
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison. Hashing first makes both sides 32 bytes, so lengths are not leaked. */
export function passcodeMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

/** A display name safe to store in the audit log: trimmed, single-spaced, 1-60 characters, no control characters. */
export function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (CONTROL_CHARS.test(raw)) return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH ? name : null;
}
