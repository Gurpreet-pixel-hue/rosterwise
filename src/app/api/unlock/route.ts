import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/server/auth/session";
import { attemptUnlock } from "@/server/auth/unlock";
import { clientIp, isSameOrigin } from "@/server/auth/request";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

const json = (body: object, status: number, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** POST /api/unlock { passcode, name }: sets the signed session cookie, or refuses (400, 401, 403, 429, 503). */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers)) return json({ message: "Cross-site request refused." }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ message: "Send JSON: { passcode, name }." }, 400);
  }
  const { passcode, name } = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;

  const r = await attemptUnlock(prisma, { passcode, name, ip: clientIp(req.headers) });
  if (!r.ok)
    return json(
      { message: r.message },
      r.status,
      r.status === 429 ? { "Retry-After": "900" } : undefined,
    );

  const res = json({ ok: true, name: r.name }, 200);
  res.cookies.set(SESSION_COOKIE, r.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
