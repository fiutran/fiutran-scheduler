import { NextResponse, type NextRequest } from "next/server";
import { currentPersonId } from "@/lib/server/store";
import { teamBusy } from "@/lib/server/team";

export const dynamic = "force-dynamic";

/** Everyone's busy times between ?start= and ?end= (signed-in team members only). */
export async function GET(req: NextRequest) {
  const me = await currentPersonId();
  if (!me) return NextResponse.json({ error: "Sign in by connecting your calendar." }, { status: 401 });
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || Date.parse(end) - Date.parse(start) > 45 * 864e5) {
    return NextResponse.json({ error: "start and end are required (at most 45 days apart)" }, { status: 400 });
  }
  return NextResponse.json(await teamBusy(me, new Date(start), new Date(end)));
}
