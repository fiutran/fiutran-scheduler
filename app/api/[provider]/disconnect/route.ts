import { NextResponse } from "next/server";
import { getProvider, PROVIDERS } from "@/lib/server/providers";
import { clearMe, sameOrigin } from "@/lib/server/session";
import { clearConn, currentPersonId, dbConfigured, readConn } from "@/lib/server/store";
import type { CalendarProvider } from "@/lib/types";

type Ctx = { params: Promise<{ provider: string }> };

/** Revokes access where the provider supports it, and forgets the connection. */
export async function POST(req: Request, { params }: Ctx) {
  const p = getProvider((await params).provider);
  if (!p) return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const session = await readConn(p.id);
  if (session) await p.revoke(session);
  await clearConn(p.id);
  // In shared mode, disconnecting your last calendar signs you out of the team view.
  if (dbConfigured()) {
    const me = await currentPersonId();
    const left = me ? await Promise.all((Object.keys(PROVIDERS) as CalendarProvider[]).map((x) => readConn(x, me))) : [];
    if (!left.some(Boolean)) await clearMe();
  }
  return NextResponse.json({ connected: false });
}
