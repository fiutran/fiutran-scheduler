import { NextResponse } from "next/server";
import { currentPersonId, dbConfigured, teamConnections } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** Whether team sharing is on, who this browser is signed in as, and who has connected what. */
export async function GET() {
  const shared = dbConfigured();
  const me = shared ? await currentPersonId() : null;
  return NextResponse.json({ shared, me, connections: me ? await teamConnections() : {} });
}
