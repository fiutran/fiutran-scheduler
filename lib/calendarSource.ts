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

/* ------------------------------------------------------------------ */
/* Real Google Calendar for "you" (two-way). Server side: app/api/google/* */
/* ------------------------------------------------------------------ */

export type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  /** Your Google profile name, used for the "you" row. Null for sessions made before it was requested. */
  name: string | null;
  firstName: string | null;
};

/** Whether this deployment has Google credentials, and whether you're signed in. */
export async function getGoogleStatus(): Promise<GoogleStatus> {
  try {
    const res = await fetch("/api/google/status", { cache: "no-store" });
    if (!res.ok) throw new Error();
    return (await res.json()) as GoogleStatus;
  } catch {
    return { configured: false, connected: false, email: null, name: null, firstName: null };
  }
}

/** Full-page redirect to Google's consent screen; returns to My profile afterwards. */
export function connectGoogle(): void {
  window.location.href = "/api/google/connect";
}

export async function disconnectGoogle(): Promise<void> {
  await fetch("/api/google/disconnect", { method: "POST" });
}

export class GoogleNotConnectedError extends Error {}

/** Read: your real Google events in the range, as busy blocks on your row. */
export async function getGoogleBusyEvents(
  personId: string,
  rangeStartUtc: Date,
  rangeEndUtc: Date,
): Promise<BusyEvent[]> {
  const q = new URLSearchParams({ start: rangeStartUtc.toISOString(), end: rangeEndUtc.toISOString() });
  const res = await fetch(`/api/google/events?${q}`, { cache: "no-store" });
  if (res.status === 401) throw new GoogleNotConnectedError((await res.json()).error);
  if (!res.ok) throw new Error("Couldn't load your Google Calendar");
  const { events } = (await res.json()) as { events: { id: string; startUtc: string; endUtc: string; title: string }[] };
  return events.map((e) => ({ id: `google-${e.id}`, personId, startUtc: e.startUtc, endUtc: e.endUtc, title: e.title, source: "google" }));
}

/** Write: creates the meeting in your Google Calendar. Returns its Google id and link. */
export async function createGoogleEvent(meeting: {
  title: string;
  startUtc: string;
  endUtc: string;
  attendeeNames: string[];
}): Promise<{ id: string; htmlLink?: string }> {
  const res = await fetch("/api/google/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meeting),
  });
  if (res.status === 401) throw new GoogleNotConnectedError((await res.json()).error);
  if (!res.ok) throw new Error("Couldn't add the meeting to Google Calendar");
  return (await res.json()) as { id: string; htmlLink?: string };
}
