/**
 * Team-wide reads and writes (shared database mode).
 * Busy times for everyone come from each person's stored calendar connections;
 * meeting titles are only returned for the person asking.
 */
import "server-only";
import { occurrences } from "@/lib/recurrence";
import { TEAM } from "@/lib/team";
import type { BusyEvent, CalendarProvider, Person, TimeOffBlock } from "@/lib/types";
import { NotConnectedError, PROVIDERS, activeSession } from "./providers";
import { readMeetings, readTimeOff, teamConnections, type StoredMeeting } from "./store";

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
export async function teamBusy(
  me: string,
  from: Date,
  to: Date,
): Promise<{ events: BusyEvent[]; problems: Problem[]; myTimeOff: TimeOffBlock[] }> {
  const [conns, timeOff] = await Promise.all([teamConnections(), readTimeOff()]);
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
  const fromMeetings: BusyEvent[] = (await readMeetings()).flatMap((m: StoredMeeting) => {
    const start = Date.parse(m.startUtc);
    const end = Date.parse(m.endUtc);
    // A series contributes every occurrence that falls in the range.
    const times = (m.recurrence ? occurrences(start, end, m.recurrence) : [{ start, end }]).filter(
      (o) => o.start < to.getTime() && o.end > from.getTime(),
    );
    const blocked = m.attendeeIds.filter((pid) => !m.writes.some((w) => w.personId === pid && (conns[pid] ?? []).includes(w.provider)));
    return times.flatMap((o) =>
      blocked.map((pid) => ({
        id: `${m.id}-${o.start}-${pid}`,
        personId: pid,
        startUtc: new Date(o.start).toISOString(),
        endUtc: new Date(o.end).toISOString(),
        title: pid === me ? m.title : undefined,
        source: "fiutran" as const,
      })),
    );
  });
  // Time off blocked in the app: busy for everyone to see; the reason is only shown to its owner.
  const fromTimeOff: BusyEvent[] = timeOff
    .filter((b) => Date.parse(b.startUtc) < to.getTime() && Date.parse(b.endUtc) > from.getTime())
    .map((b) => ({
      id: b.id,
      personId: b.personId,
      startUtc: b.startUtc,
      endUtc: b.endUtc,
      title: b.personId === me ? `Time off: ${b.reason}` : undefined,
      source: "timeoff" as const,
    }));
  const myTimeOff = timeOff
    .filter((b) => b.personId === me)
    .map(({ id, startUtc, endUtc, reason }) => ({ id, startUtc, endUtc, reason }))
    .sort((a, z) => a.startUtc.localeCompare(z.startUtc));
  return { events: [...lists.flat(), ...fromMeetings, ...fromTimeOff], problems, myTimeOff };
}
