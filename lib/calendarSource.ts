/**
 * The ONLY data entry point for the app. Every screen reads people and busy
 * times through these functions.
 *
 * - getPeople(): the Fiutran team (lib/team.ts).
 * - getBusyEvents(): busy times that come from outside a connected calendar.
 *   There is no sample data any more, so this is empty; once the shared
 *   database exists it will return teammates' synced busy times.
 * - Real calendars for "you" (Google Calendar, Outlook): see below.
 *
 * All functions are async so callers don't change when they hit the network.
 */
import type { BusyEvent, CalendarProvider, Person } from "./types";
import { TEAM } from "./team";

export async function getPeople(): Promise<Person[]> {
  return TEAM.map((p) => ({ ...p, workDays: [...p.workDays] }));
}

/** Busy intervals for one person that overlap [rangeStartUtc, rangeEndUtc), as UTC ISO strings. */
export async function getBusyEvents(
  _personId: string,
  _rangeStartUtc: Date,
  _rangeEndUtc: Date,
): Promise<BusyEvent[]> {
  return [];
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

const LABEL: Record<CalendarProvider, string> = { google: "Google Calendar", outlook: "Outlook calendar", icloud: "iCloud calendar" };

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
  if (!res.ok) throw new Error(`Couldn't load your ${LABEL[provider]}`);
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
  if (!res.ok) throw new Error(`Couldn't add the meeting to your ${LABEL[provider]}`);
  return (await res.json()) as { id: string; link?: string };
}

/* ------------------------------------------------------------------ */
/* Team sharing (shared database). Server side: app/api/team/*,        */
/* app/api/meetings, lib/server/team.ts.                               */
/* ------------------------------------------------------------------ */

export type TeamStatus = {
  /** True when the shared database is set up on this site. */
  shared: boolean;
  /** The team member this browser is signed in as (by connecting a calendar with their email). */
  me: string | null;
  /** Which calendars each team member has connected. */
  connections: Record<string, CalendarProvider[]>;
};

export async function getTeamStatus(): Promise<TeamStatus> {
  try {
    const res = await fetch("/api/team/status", { cache: "no-store" });
    if (!res.ok) throw new Error();
    return (await res.json()) as TeamStatus;
  } catch {
    return { shared: false, me: null, connections: {} };
  }
}

export class TeamSignInError extends Error {}
export type TeamProblem = { personId: string; provider: CalendarProvider; error: string };

/** Everyone's busy times in the range (titles only for your own events). */
export async function getTeamBusy(from: Date, to: Date): Promise<{ events: BusyEvent[]; problems: TeamProblem[] }> {
  const q = new URLSearchParams({ start: from.toISOString(), end: to.toISOString() });
  const res = await fetch(`/api/team/busy?${q}`, { cache: "no-store" });
  if (res.status === 401) throw new TeamSignInError((await res.json()).error);
  if (!res.ok) throw new Error("Couldn't load the team's calendars");
  return res.json();
}

export type TeamWrite = { personId: string; provider: CalendarProvider; eventId: string; link?: string };

/** Saves a meeting for the team and adds it quietly to each attendee's calendar. */
export async function createTeamMeeting(m: {
  title: string;
  startUtc: string;
  endUtc: string;
  attendeeIds: string[];
  addTo?: CalendarProvider;
}): Promise<{ writes: TeamWrite[]; failures: { personId: string; provider: CalendarProvider }[] }> {
  const res = await fetch("/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(m),
  });
  if (res.status === 401) throw new TeamSignInError((await res.json()).error);
  if (!res.ok) throw new Error("Couldn't save the meeting");
  return res.json();
}

/** Connects iCloud Calendar with an Apple ID and app-specific password. Throws with a readable message. */
export async function connectICloud(appleId: string, password: string): Promise<{ calendars: string[] }> {
  const res = await fetch("/api/icloud/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appleId, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; calendars?: string[] };
  if (!res.ok) throw new Error(body.error ?? "Couldn't connect iCloud");
  return { calendars: body.calendars ?? [] };
}
