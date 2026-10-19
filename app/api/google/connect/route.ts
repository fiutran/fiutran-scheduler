import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_SCOPES, STATE_COOKIE, isGoogleConfigured, redirectUri } from "@/lib/server/googleAuth";

/** Starts Google sign-in. Asks for offline access so the connection survives the 1-hour access token. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  if (!isGoogleConfigured()) return NextResponse.redirect(`${origin}/profile?google=not-configured`);

  const state = randomBytes(16).toString("hex");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
