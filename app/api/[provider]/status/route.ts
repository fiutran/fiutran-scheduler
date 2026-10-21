import { NextResponse } from "next/server";
import { ensureName, getProvider } from "@/lib/server/providers";
import { readSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ provider: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const p = getProvider((await params).provider);
  if (!p) return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  const configured = p.configured();
  const stored = configured ? await readSession(p.id) : null;
  const session = stored ? await ensureName(p, stored) : null;
  return NextResponse.json({
    configured,
    connected: Boolean(session),
    email: session?.email ?? null,
    name: session?.name ?? null,
    firstName: session?.firstName ?? null,
  });
}
