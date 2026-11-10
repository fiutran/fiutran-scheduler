import { NextResponse } from "next/server";
import { currentPersonId, teamVersion } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** A change counter for team data. Browsers poll this (one cheap read) and reload when it moves. */
export async function GET() {
  const me = await currentPersonId();
  if (!me) return NextResponse.json({ error: "Sign in by connecting your calendar." }, { status: 401 });
  return NextResponse.json({ version: await teamVersion() }, { headers: { "Cache-Control": "no-store" } });
}
