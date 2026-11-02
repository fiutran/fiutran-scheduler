import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { discoverCalendars, ICloudAuthError } from "@/lib/server/icloud";
import { getProvider } from "@/lib/server/providers";
import { cookieOptions, sameOrigin, stateCookie } from "@/lib/server/session";
import { currentPersonId, writeConn } from "@/lib/server/store";

type Ctx = { params: Promise<{ provider: string }> };

/** Google / Outlook: starts sign-in at the provider. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const p = getProvider((await params).provider);
  if (!p) return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  const origin = req.nextUrl.origin;
  if (p.kind !== "oauth") return NextResponse.redirect(`${origin}/profile`);
  if (!p.configured()) return NextResponse.redirect(`${origin}/profile?calendar=${p.id}&result=not-configured`);

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(p.authorizeUrl(`${origin}/api/${p.id}/callback`, state));
  res.cookies.set(stateCookie(p.id), state, { ...cookieOptions, maxAge: 600 });
  return res;
}

/** iCloud: connects with an Apple ID and an app-specific password (Apple has no calendar sign-in page). */
export async function POST(req: Request, { params }: Ctx) {
  const p = getProvider((await params).provider);
  if (!p || p.kind !== "password") return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  if (!p.configured()) return NextResponse.json({ error: "iCloud needs the shared database, which isn't set up yet." }, { status: 400 });
  const me = await currentPersonId();
  if (!me) return NextResponse.json({ error: "Connect Google or Outlook first, so the app knows who you are." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { appleId?: string; password?: string } | null;
  const appleId = body?.appleId?.trim() ?? "";
  const password = body?.password?.replace(/\s+/g, "") ?? "";
  if (!/^\S+@\S+\.\S+$/.test(appleId) || password.length < 8) {
    return NextResponse.json({ error: "Enter your Apple ID email and the app-specific password." }, { status: 400 });
  }
  try {
    // Apple shows app-specific passwords as xxxx-xxxx-xxxx-xxxx: try it as typed, then without the dashes.
    let accepted = password;
    let calendars;
    try {
      calendars = await discoverCalendars(appleId, password);
    } catch (err) {
      if (!(err instanceof ICloudAuthError) || !password.includes("-")) throw err;
      accepted = password.replace(/-/g, "");
      calendars = await discoverCalendars(appleId, accepted);
    }
    if (!calendars.length) return NextResponse.json({ error: "No iCloud calendars were found for this Apple ID." }, { status: 400 });
    await writeConn(
      p.id,
      { accessToken: "", expiresAt: Number.MAX_SAFE_INTEGER, email: appleId, extra: { password: accepted, calendars } },
      me,
    );
    return NextResponse.json({ connected: true, calendars: calendars.map((c) => c.name) });
  } catch (err) {
    if (err instanceof ICloudAuthError) {
      return NextResponse.json({ error: "Apple didn't accept that Apple ID and app-specific password." }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Couldn't reach iCloud. Please try again." }, { status: 502 });
  }
}
