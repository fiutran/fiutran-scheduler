import { NextResponse, type NextRequest } from "next/server";
import { NotConnectedError, activeSession, getProvider } from "@/lib/server/providers";
import { sameOrigin } from "@/lib/server/session";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ provider: string }> };

function fail(err: unknown) {
  if (err instanceof NotConnectedError) return NextResponse.json({ error: err.message }, { status: 401 });
  console.error(err);
  return NextResponse.json({ error: "Calendar request failed" }, { status: 502 });
}

/** Read: your busy events between ?start= and ?end= (ISO, UTC). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const p = getProvider((await params).provider);
  if (!p) return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  }
  try {
    const s = await activeSession(p);
    const events = await p.listEvents(s.accessToken, new Date(start).toISOString(), new Date(end).toISOString());
    return NextResponse.json({ events });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Write: adds a sent meeting to your calendar. Teammates are named in the description only,
 * never added as guests, so no invitations are emailed.
 */
export async function POST(req: Request, { params }: Ctx) {
  const p = getProvider((await params).provider);
  if (!p) return NextResponse.json({ error: "Unknown calendar" }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as
    | { title?: string; startUtc?: string; endUtc?: string; attendeeNames?: string[] }
    | null;
  const start = body?.startUtc ? Date.parse(body.startUtc) : NaN;
  const end = body?.endUtc ? Date.parse(body.endUtc) : NaN;
  if (!body || Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > 24 * 3600_000) {
    return NextResponse.json({ error: "Invalid meeting" }, { status: 400 });
  }
  try {
    const s = await activeSession(p);
    const created = await p.createEvent(s.accessToken, {
      title: (body.title ?? "").slice(0, 200) || "Untitled meeting",
      startUtc: new Date(start).toISOString(),
      endUtc: new Date(end).toISOString(),
      description: `Scheduled with Fiutran Scheduler (prototype).\nInvited from the sample team: ${(body.attendeeNames ?? [])
        .slice(0, 20)
        .join(", ")}`,
    });
    return NextResponse.json(created);
  } catch (err) {
    return fail(err);
  }
}
