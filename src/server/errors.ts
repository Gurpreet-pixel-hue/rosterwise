import type { ZodType } from "zod";

export type ServiceErrorCode =
  | "VALIDATION" // the input is malformed or breaks a rule
  | "NOT_FOUND"
  | "CONFLICT" // the data is in a state that does not allow this (stale version, referenced row, ...)
  | "BLOCKED" // a business gate said no (e.g. unacknowledged ERRORs block publishing)
  | "UNAUTHORIZED"; // no valid passcode session: the write was refused and nothing was changed

/** An expected failure with a stable code, a readable message and optional structured detail. */
export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: ServiceErrorCode | "INTERNAL"; message: string; details?: unknown };
    };

/** Run a service call and turn expected failures into a plain, serialisable result (for server actions). */
export async function toResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ServiceError)
      return { ok: false, error: { code: e.code, message: e.message, details: e.details } };
    console.error(e);
    return {
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong. The change was not saved." },
    };
  }
}

/** Parse untrusted input with a Zod schema; throw a VALIDATION error listing every problem. */
export function parse<T>(schema: ZodType<T>, input: unknown, what = "input"): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const problems = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  throw new ServiceError(
    "VALIDATION",
    `Invalid ${what}: ${problems.map((p) => (p.path ? `${p.path}: ${p.message}` : p.message)).join("; ")}`,
    problems,
  );
}
