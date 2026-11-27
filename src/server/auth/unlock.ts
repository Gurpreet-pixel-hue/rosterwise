// Checking a passcode attempt: validates the name, enforces the per-IP brute-force limit in Postgres, compares
// the passcode in constant time, and issues the signed session token. The route handler is a thin wrapper.
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  SESSION_TTL_MS,
  authConfig,
  cleanDisplayName,
  passcodeMatches,
  signSession,
} from "./session";

export const MAX_FAILED_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export interface UnlockRequest {
  passcode: unknown;
  name: unknown;
  ip: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}

export type UnlockResult =
  | { ok: true; token: string; name: string; expiresAt: number }
  | { ok: false; status: 400 | 401 | 429 | 503; message: string };

const ipHash = (ip: string, secret: string) =>
  createHash("sha256").update(`${secret}|${ip}`).digest("hex");

export async function attemptUnlock(db: PrismaClient, req: UnlockRequest): Promise<UnlockResult> {
  const cfg = authConfig(req.env ?? process.env);
  if (!cfg.configured)
    return {
      ok: false,
      status: 503,
      message: "Editing is disabled: the passcode is not configured.",
    };

  const name = cleanDisplayName(req.name);
  if (!name)
    return {
      ok: false,
      status: 400,
      message: "Enter a display name (1 to 60 characters, no line breaks).",
    };
  if (typeof req.passcode !== "string" || req.passcode.length > 200)
    return { ok: false, status: 401, message: "That passcode is not right." };

  const now = req.now ?? new Date();
  const since = new Date(now.getTime() - WINDOW_MS);
  const hash = ipHash(req.ip, cfg.secret);

  await db.unlockAttempt.deleteMany({ where: { createdAt: { lt: since } } });
  const failures = await db.unlockAttempt.count({
    where: { ipHash: hash, createdAt: { gte: since } },
  });
  if (failures >= MAX_FAILED_ATTEMPTS)
    return {
      ok: false,
      status: 429,
      message: "Too many wrong passcodes. Try again in 15 minutes.",
    };

  if (!passcodeMatches(req.passcode, cfg.passcode)) {
    await db.unlockAttempt.create({ data: { ipHash: hash, createdAt: now } });
    return { ok: false, status: 401, message: "That passcode is not right." };
  }

  await db.unlockAttempt.deleteMany({ where: { ipHash: hash } });
  const expiresAt = now.getTime() + SESSION_TTL_MS;
  return { ok: true, token: signSession({ name, exp: expiresAt }, cfg.secret), name, expiresAt };
}
