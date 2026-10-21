import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getProvider } from "@/lib/server/providers";
import { cookieOptions, stateCookie } from "@/lib/server/session";

type Ctx = { params: Promise<{ provider: string }> };

/** Starts sign-in with Google or Microsoft. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const p = getProvider((await params).provider);
  if (!p) return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  const origin = req.nextUrl.origin;
  if (!p.configured()) return NextResponse.redirect(`${origin}/profile?calendar=${p.id}&result=not-configured`);

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(p.authorizeUrl(`${origin}/api/${p.id}/callback`, state));
  res.cookies.set(stateCookie(p.id), state, { ...cookieOptions, maxAge: 600 });
  return res;
}
