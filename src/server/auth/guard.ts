// The one guard every mutating server action goes through. Reading is public; writing needs an unlocked
// session (the shared passcode). The audit actor is taken from the session here, never from the browser.
import { cookies } from "next/headers";
import type { Result } from "../errors";
import { SESSION_COOKIE, type Session, authConfig, verifySession } from "./session";

/** The current session, or null if there is none, it expired, it was tampered with, or auth is not configured. */
export async function currentSession(): Promise<Session | null> {
  const cfg = authConfig();
  if (!cfg.configured) return null; // fail closed
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySession(token, cfg.secret, Date.now()) : null;
}

const refused = (): Result<never> => ({
  ok: false,
  error: {
    code: "UNAUTHORIZED",
    message: authConfig().configured
      ? "Locked: enter the passcode (Unlock, top right) to make changes."
      : "Editing is disabled on this deployment.",
  },
});

/** Run a write only for an unlocked session. Locked: nothing runs and nothing is written. */
export async function guarded<T>(
  run: (session: Session) => Promise<Result<T>>,
): Promise<Result<T>> {
  const session = await currentSession();
  return session ? run(session) : refused();
}

/** The input with `actor` forced to the session's name, so a client cannot choose who the audit log blames. */
export function withActor(input: unknown, session: Session): unknown {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? { ...input, actor: session.name }
    : input;
}
