import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/session";
import { isSameOrigin } from "@/server/auth/request";

export const dynamic = "force-dynamic";

/** POST /api/lock: ends the session by clearing the cookie. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers))
    return NextResponse.json({ message: "Cross-site request refused." }, { status: 403 });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
