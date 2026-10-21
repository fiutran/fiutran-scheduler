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
import type { BusyEvent, CalendarProvider, Person } from "./types";
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

/* ------------------------------------------------------------------ */
/* Real calendars for "you" (two-way): Google Calendar and Outlook.    */
/* Server side: app/api/[provider]/* and lib/server/providers.ts.      */
/* ------------------------------------------------------------------ */

export type LiveStatus = {
  /** False when this deployment has no credentials for the provider; it then stays simulated. */
  configured: boolean;
  connected: boolean;
  email: string | null;
  /** Your profile name, used for the "you" row. */
  name: string | null;
  firstName: string | null;
};

const OFFLINE: LiveStatus = { configured: false, connected: false, email: null, name: null, firstName: null };

export async function getLiveStatus(provider: CalendarProvider): Promise<LiveStatus> {
  try {
    const res = await fetch(`/api/${provider}/status`, { cache: "no-store" });
    if (!res.ok) throw new Error();
    return (await res.json()) as LiveStatus;
  } catch {
    return OFFLINE;
  }
}

/** Full-page redirect to the provider's consent screen; returns to My profile afterwards. */
export function connectLive(provider: CalendarProvider): void {
  window.location.href = `/api/${provider}/connect`;
}

export async function disconnectLive(provider: CalendarProvider): Promise<void> {
  await fetch(`/api/${provider}/disconnect`, { method: "POST" });
}

export class LiveNotConnectedError extends Error {}

/** Read: your real events in the range, as busy blocks on your row. */
export async function getLiveBusyEvents(
  provider: CalendarProvider,
  personId: string,
  rangeStartUtc: Date,
  rangeEndUtc: Date,
): Promise<BusyEvent[]> {
  const q = new URLSearchParams({ start: rangeStartUtc.toISOString(), end: rangeEndUtc.toISOString() });
  const res = await fetch(`/api/${provider}/events?${q}`, { cache: "no-store" });
  if (res.status === 401) throw new LiveNotConnectedError((await res.json()).error);
  if (!res.ok) throw new Error(`Couldn't load your ${provider === "google" ? "Google Calendar" : "Outlook calendar"}`);
  const { events } = (await res.json()) as { events: { id: string; startUtc: string; endUtc: string; title: string }[] };
  return events.map((e) => ({
    id: `${provider}-${e.id}`,
    personId,
    startUtc: e.startUtc,
    endUtc: e.endUtc,
    title: e.title,
    source: provider,
  }));
}

/** Write: creates the meeting in your calendar. Returns the provider's event id and a link to it. */
export async function createLiveEvent(
  provider: CalendarProvider,
  meeting: { title: string; startUtc: string; endUtc: string; attendeeNames: string[] },
): Promise<{ id: string; link?: string }> {
  const res = await fetch(`/api/${provider}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meeting),
  });
  if (res.status === 401) throw new LiveNotConnectedError((await res.json()).error);
  if (!res.ok) throw new Error(`Couldn't add the meeting to your ${provider === "google" ? "Google Calendar" : "Outlook calendar"}`);
  return (await res.json()) as { id: string; link?: string };
}
