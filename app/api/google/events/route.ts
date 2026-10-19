import { NextResponse, type NextRequest } from "next/server";
import { NotConnectedError, calendarFetch, sameOrigin } from "@/lib/server/googleAuth";

export const dynamic = "force-dynamic";

type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

function fail(err: unknown) {
  if (err instanceof NotConnectedError) return NextResponse.json({ error: err.message }, { status: 401 });
  console.error(err);
  return NextResponse.json({ error: "Google Calendar request failed" }, { status: 502 });
}

/** Read: your busy events on your primary calendar between ?start= and ?end= (ISO, UTC). */
export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  try {
    const items: GEvent[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({
        timeMin: new Date(start).toISOString(),
        timeMax: new Date(end).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await calendarFetch(`/calendars/primary/events?${q}`);
      if (res.status === 401) throw new NotConnectedError("Google access was revoked; connect again");
      if (!res.ok) throw new Error(`events.list ${res.status}: ${await res.text()}`);
      const page = (await res.json()) as { items?: GEvent[]; nextPageToken?: string };
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    const events = items
      // Busy only: timed, not cancelled, not marked "Free", not declined by you. All-day events are skipped.
      .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent" && e.start?.dateTime && e.end?.dateTime)
      .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === "declined"))
      .map((e) => ({
        id: e.id,
        startUtc: new Date(e.start!.dateTime!).toISOString(),
        endUtc: new Date(e.end!.dateTime!).toISOString(),
        title: e.summary ?? "(No title)",
        htmlLink: e.htmlLink,
      }));
    return NextResponse.json({ events });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Write: adds a sent meeting to your primary calendar. The sample teammates are
 * listed in the description only, never as attendees, so Google emails no one.
 */
export async function POST(req: Request) {
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
    const res = await calendarFetch("/calendars/primary/events?sendUpdates=none", {
      method: "POST",
      body: JSON.stringify({
        summary: (body.title ?? "").slice(0, 200) || "Untitled meeting",
        description: `Scheduled with Fiutran Scheduler (prototype).\nInvited from the sample team: ${(body.attendeeNames ?? [])
          .slice(0, 20)
          .join(", ")}`,
        start: { dateTime: new Date(start).toISOString() },
        end: { dateTime: new Date(end).toISOString() },
        extendedProperties: { private: { fiutranScheduler: "1" } },
      }),
    });
    if (res.status === 401) throw new NotConnectedError("Google access was revoked; connect again");
    if (!res.ok) throw new Error(`events.insert ${res.status}: ${await res.text()}`);
    const e = (await res.json()) as GEvent;
    return NextResponse.json({ id: e.id, htmlLink: e.htmlLink });
  } catch (err) {
    return fail(err);
  }
}
