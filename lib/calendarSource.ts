/**
 * The ONLY data entry point for the app. Every screen reads people and busy
 * times through these two functions, so swapping the sample data for real
 * calendars is a change to this file alone.
 *
 * Today: returns sample data from ./mockData.
 * Later:
 *   - getPeople()      -> your directory (Microsoft Graph /users, Google Workspace
 *                         Directory API) merged with each person's saved profile.
 *   - getBusyEvents()  -> Outlook: POST /me/calendar/getSchedule (Microsoft Graph)
 *                         Google:  POST /calendar/v3/freeBusy
 *                         Both return busy intervals in UTC without titles for
 *                         other people, which matches how the UI already behaves.
 *
 * Both functions are async on purpose so callers don't change when they hit the network.
 */
import type { BusyEvent, Person } from "./types";
import { MOCK_PEOPLE, buildMockEvents } from "./mockData";

/** Simulated network latency so loading states are exercised in the demo. */
const LATENCY_MS = 250;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getPeople(): Promise<Person[]> {
  await wait(LATENCY_MS);
  return MOCK_PEOPLE.map((p) => ({ ...p, workDays: [...p.workDays] }));
}

/**
 * Busy intervals for one person that overlap [rangeStartUtc, rangeEndUtc).
 * All returned times are UTC ISO strings.
 */
export async function getBusyEvents(
  personId: string,
  rangeStartUtc: Date,
  rangeEndUtc: Date,
): Promise<BusyEvent[]> {
  await wait(LATENCY_MS);
  const from = rangeStartUtc.getTime();
  const to = rangeEndUtc.getTime();
  return buildMockEvents().filter(
    (e) => e.personId === personId && Date.parse(e.startUtc) < to && Date.parse(e.endUtc) > from,
  );
}
