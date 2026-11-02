import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { TEAM } from "@/lib/team";
import type { CalendarProvider } from "@/lib/types";
import { PROVIDERS, activeSession } from "@/lib/server/providers";
import { sameOrigin } from "@/lib/server/session";
import { addMeeting, currentPersonId, teamConnections, type MeetingWrite } from "@/lib/server/store";
import { writeTargetFor } from "@/lib/server/team";

/**
 * Creates a meeting for the team: saved centrally, and added quietly to each attendee's
 * calendar (no invitation emails). Teammates without a connected calendar still see it as busy.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const me = await currentPersonId();
  if (!me) return NextResponse.json({ error: "Sign in by connecting your calendar." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { title?: string; startUtc?: string; endUtc?: string; attendeeIds?: string[]; addTo?: CalendarProvider }
    | null;
  const start = body?.startUtc ? Date.parse(body.startUtc) : NaN;
  const end = body?.endUtc ? Date.parse(body.endUtc) : NaN;
  const attendees = TEAM.filter((p) => body?.attendeeIds?.includes(p.id));
  if (!body || Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > 24 * 3600_000 || !attendees.length) {
    return NextResponse.json({ error: "Invalid meeting" }, { status: 400 });
  }

  const title = (body.title ?? "").trim().slice(0, 200) || "Untitled meeting";
  const startUtc = new Date(start).toISOString();
  const endUtc = new Date(end).toISOString();
  const organizer = TEAM.find((p) => p.id === me)!;
  const description = `Scheduled with Fiutran Scheduler by ${organizer.name}.\nWith: ${attendees.map((p) => p.name).join(", ")}`;
  const conns = await teamConnections();

  const writes: MeetingWrite[] = [];
  const failures: { personId: string; provider: CalendarProvider }[] = [];
  await Promise.all(
    attendees.map(async (person) => {
      const target = writeTargetFor(person, conns[person.id] ?? [], body.addTo, person.id === me);
      if (!target) return;
      try {
        const s = await activeSession(PROVIDERS[target], person.id);
        const created = await PROVIDERS[target].createEvent(s, { title, startUtc, endUtc, description });
        writes.push({ personId: person.id, provider: target, eventId: created.id, link: created.link });
      } catch (err) {
        console.error(err);
        failures.push({ personId: person.id, provider: target });
      }
    }),
  );

  const meeting = {
    id: `mtg-${randomUUID()}`,
    title,
    startUtc,
    endUtc,
    attendeeIds: attendees.map((p) => p.id),
    organizerId: me,
    writes,
    createdAt: new Date().toISOString(),
  };
  await addMeeting(meeting);
  return NextResponse.json({ meeting: { ...meeting, writes: undefined }, writes, failures });
}
