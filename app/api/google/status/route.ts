import { NextResponse } from "next/server";
import { ensureName, isGoogleConfigured, readSession } from "@/lib/server/googleAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isGoogleConfigured();
  const stored = configured ? await readSession() : null;
  const session = stored ? await ensureName(stored) : null;
  return NextResponse.json({
    configured,
    connected: Boolean(session),
    email: session?.email ?? null,
    name: session?.name ?? null,
    firstName: session?.firstName ?? null,
  });
}
