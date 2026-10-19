import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, isGoogleConfigured, redirectUri, tokenRequest, writeSession } from "@/lib/server/googleAuth";

/** Google redirects here after consent. Swaps the code for tokens and stores them in the encrypted cookie. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const back = (status: string) => {
    const res = NextResponse.redirect(`${origin}/profile?google=${status}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  if (!isGoogleConfigured()) return back("not-configured");
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("denied");
  const state = params.get("state");
  if (!state || state !== req.cookies.get(STATE_COOKIE)?.value) return back("error");

  try {
    const t = await tokenRequest({
      grant_type: "authorization_code",
      code: params.get("code") ?? "",
      redirect_uri: redirectUri(origin),
    });
    // The user can untick the calendar permission on Google's consent screen.
    if (!/calendar\.events/.test((t as { scope?: string }).scope ?? "")) return back("missing-permission");

    // id_token came straight from Google's token endpoint over TLS, so reading its payload is safe.
    const payload = t.id_token ? JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()) : {};
    await writeSession({
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      email: payload.email ?? "Google account",
      name: payload.name,
      firstName: payload.given_name,
    });
    return back("connected");
  } catch (err) {
    console.error(err);
    return back("error");
  }
}
