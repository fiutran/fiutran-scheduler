import { NextResponse } from "next/server";
import { clearSession, readSession, sameOrigin } from "@/lib/server/googleAuth";

/** Revokes Fiutran's access at Google and forgets the tokens. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const session = await readSession();
  const token = session?.refreshToken ?? session?.accessToken;
  if (token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(
      () => undefined,
    );
  }
  await clearSession();
  return NextResponse.json({ connected: false });
}
