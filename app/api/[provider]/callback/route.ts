import { NextResponse, type NextRequest } from "next/server";
import { getProvider } from "@/lib/server/providers";
import { stateCookie, writeMe } from "@/lib/server/session";
import { currentPersonId, dbConfigured, teamMemberByEmail, writeConn } from "@/lib/server/store";

type Ctx = { params: Promise<{ provider: string }> };

/** The provider redirects here after consent. Swaps the code for tokens and stores the connection. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const p = getProvider((await params).provider);
  if (!p || p.kind !== "oauth") return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  const origin = req.nextUrl.origin;
  const back = (result: string) => {
    const res = NextResponse.redirect(`${origin}/profile?calendar=${p.id}&result=${result}`);
    res.cookies.delete(stateCookie(p.id));
    return res;
  };

  if (!p.configured()) return back("not-configured");
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "denied" : "error");
  const state = q.get("state");
  if (!state || state !== req.cookies.get(stateCookie(p.id))?.value) return back("error");

  try {
    const t = await p.exchangeCode(q.get("code") ?? "", `${origin}/api/${p.id}/callback`);
    // The calendar permission can be unticked on the consent screen.
    if (!p.hasCalendarScope(t)) return back("missing-permission");
    const profile = await p.profile(t);
    const session = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      email: profile.email ?? `${p.label} account`,
      name: profile.name,
      firstName: profile.firstName,
    };

    if (!dbConfigured()) {
      await writeConn(p.id, session);
      return back("connected");
    }
    // Shared mode: the account must belong to the team. Once signed in, extra calendars attach to you.
    const member = teamMemberByEmail(profile.email);
    const signedIn = await currentPersonId();
    if (signedIn && member && member.id !== signedIn) return back("belongs-to-teammate");
    const personId = signedIn ?? member?.id;
    if (!personId) return back("not-on-team");
    await writeConn(p.id, session, personId);
    if (!signedIn) await writeMe(personId);
    return back("connected");
  } catch (err) {
    console.error(err);
    return back("error");
  }
}
