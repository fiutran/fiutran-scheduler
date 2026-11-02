/**
 * Team-wide reads and writes (shared database mode).
 * Busy times for everyone come from each person's stored calendar connections;
 * meeting titles are only returned for the person asking.
 */
import "server-only";
import { TEAM } from "@/lib/team";
import type { BusyEvent, CalendarProvider, Person } from "@/lib/types";
import { NotConnectedError, PROVIDERS, activeSession } from "./providers";
import { readMeetings, teamConnections, type StoredMeeting } from "./store";

export type Problem = { personId: string; provider: CalendarProvider; error: string };

/** Which calendar a sent meeting is written to for an attendee. */
export function writeTargetFor(
  person: Person,
  connected: CalendarProvider[],
  addTo: CalendarProvider | undefined,
  isOrganizer: boolean,
): CalendarProvider | null {
  // The organiser picks with "Add to"; everyone else gets their main calendar.
  if (isOrganizer && addTo && connected.includes(addTo)) return addTo;
  if (connected.includes(person.calendar)) return person.calendar;
  // iCloud is read-and-write for the person's own use, but app meetings for others go to Google/Outlook.
  return (["outlook", "google"] as const).find((p) => connected.includes(p)) ?? null;
}

/** Everyone's busy times in [from, to), plus meetings created in the app. */
export async function teamBusy(me: string, from: Date, to: Date): Promise<{ events: BusyEvent[]; problems: Problem[] }> {
  const conns = await teamConnections();
  const problems: Problem[] = [];
  const startIso = from.toISOString();
  const endIso = to.toISOString();

  const lists = await Promise.all(
    TEAM.flatMap((person) =>
      (conns[person.id] ?? []).map(async (provider): Promise<BusyEvent[]> => {
        try {
          const s = await activeSession(PROVIDERS[provider], person.id);
          const events = await PROVIDERS[provider].listEvents(s, startIso, endIso);
          return events.map((e) => ({
            id: `${person.id}-${provider}-${e.id}`,
            personId: person.id,
            startUtc: e.startUtc,
            endUtc: e.endUtc,
            // Only your own calendars reveal what you're busy with.
            title: person.id === me ? e.title : undefined,
            source: provider,
          }));
        } catch (err) {
          problems.push({
            personId: person.id,
            provider,
            error: err instanceof NotConnectedError ? "needs reconnecting" : "couldn't be read",
          });
          if (!(err instanceof NotConnectedError)) console.error(err);
          return [];
        }
      }),
    ),
  );

  // A meeting blocks each attendee directly, unless it was written into their calendar:
  // then the calendar copy counts, so deleting it there frees that person.
  const meetings = (await readMeetings()).filter((m) => Date.parse(m.startUtc) < to.getTime() && Date.parse(m.endUtc) > from.getTime());
  const fromMeetings: BusyEvent[] = meetings.flatMap((m: StoredMeeting) =>
    m.attendeeIds
      .filter((pid) => !m.writes.some((w) => w.personId === pid && (conns[pid] ?? []).includes(w.provider)))
      .map((pid) => ({
        id: `${m.id}-${pid}`,
        personId: pid,
        startUtc: m.startUtc,
        endUtc: m.endUtc,
        title: pid === me ? m.title : undefined,
        source: "fiutran" as const,
      })),
  );
  return { events: [...lists.flat(), ...fromMeetings], problems };
}
