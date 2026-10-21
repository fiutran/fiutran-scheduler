import { NextResponse } from "next/server";
import { getProvider } from "@/lib/server/providers";
import { clearSession, readSession, sameOrigin } from "@/lib/server/session";

type Ctx = { params: Promise<{ provider: string }> };

/** Revokes access where the provider supports it, and forgets the tokens. */
export async function POST(req: Request, { params }: Ctx) {
  const p = getProvider((await params).provider);
  if (!p) return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const session = await readSession(p.id);
  if (session) await p.revoke(session);
  await clearSession(p.id);
  return NextResponse.json({ connected: false });
}
