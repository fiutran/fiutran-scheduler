/**
 * Where calendar connections and app meetings live.
 *
 * - With the shared database: everything is stored there, encrypted, keyed by team member,
 *   so each person's calendars can be read for the whole team. The browser cookie "fs_me"
 *   only says which team member is signed in.
 * - Without it: each browser keeps its own connections in encrypted cookies (the original
 *   behaviour), and nothing is shared.
 */
import "server-only";
import { TEAM } from "@/lib/team";
import type { CalendarProvider, Meeting, TimeOffBlock } from "@/lib/types";
import { dbConfigured, dbDel, dbGet, dbIncr, dbSet } from "./db";
import { clearSession, readMe, readSession, seal, unseal, writeSession, type LiveSession } from "./session";

export { dbConfigured };

const connKey = (personId: string, p: CalendarProvider) => `fs:conn:${personId}:${p}`;
const MEETINGS_KEY = "fs:meetings";
const TIMEOFF_KEY = "fs:timeoff";
const VERSION_KEY = "fs:version";

/**
 * A counter bumped on every team-data change made through the app (meetings, time off,
 * calendar connections). Browsers poll it cheaply and reload only when it moves.
 */
export async function teamVersion(): Promise<number> {
  return Number((await dbGet(VERSION_KEY)) ?? 0);
}

async function bumpVersion(): Promise<void> {
  try {
    await dbIncr(VERSION_KEY);
  } catch (err) {
    // The change itself is saved; browsers still catch up on their periodic full sync.
    console.error(err);
  }
}

/** The team member matching an email address, if any (case-insensitive). */
export function teamMemberByEmail(email: string | undefined | null) {
  if (!email) return undefined;
  return TEAM.find((p) => p.email.toLowerCase() === email.toLowerCase());
}

/** The signed-in team member for this request (database mode only). */
export async function currentPersonId(): Promise<string | null> {
  if (!dbConfigured()) return null;
  const id = await readMe();
  return id && TEAM.some((p) => p.id === id) ? id : null;
}

/** A calendar connection. In database mode it's per team member; otherwise per browser. */
export async function readConn(p: CalendarProvider, personId?: string | null): Promise<LiveSession | null> {
  if (!dbConfigured()) return readSession(p);
  const pid = personId ?? (await currentPersonId());
  if (!pid) return null;
  const raw = await dbGet(connKey(pid, p));
  return raw ? unseal<LiveSession>(raw) : null;
}

export async function writeConn(p: CalendarProvider, session: LiveSession, personId?: string | null): Promise<void> {
  if (!dbConfigured()) return writeSession(p, session);
  const pid = personId ?? (await currentPersonId());
  if (!pid) throw new Error("Not signed in");
  const key = connKey(pid, p);
  // Token refreshes rewrite an existing connection; only a new connection changes what others see.
  const isNew = !(await dbGet(key));
  await dbSet(key, seal(session));
  if (isNew) await bumpVersion();
}

export async function clearConn(p: CalendarProvider, personId?: string | null): Promise<void> {
  if (!dbConfigured()) return clearSession(p);
  const pid = personId ?? (await currentPersonId());
  if (pid) {
    await dbDel(connKey(pid, p));
    await bumpVersion();
  }
}

/** Which calendars each team member has connected (database mode). */
export async function teamConnections(): Promise<Record<string, CalendarProvider[]>> {
  const out: Record<string, CalendarProvider[]> = {};
  const providers: CalendarProvider[] = ["google", "outlook", "icloud"];
  await Promise.all(
    TEAM.map(async (person) => {
      const have = await Promise.all(providers.map((p) => dbGet(connKey(person.id, p))));
      out[person.id] = providers.filter((_, i) => have[i]);
    }),
  );
  return out;
}

/* ------------------------------- Meetings ------------------------------- */

/** Where a meeting was written for one attendee. */
export type MeetingWrite = { personId: string; provider: CalendarProvider; eventId: string; link?: string };
export type StoredMeeting = Meeting & { organizerId: string; writes: MeetingWrite[]; createdAt: string };

export async function readMeetings(): Promise<StoredMeeting[]> {
  const raw = await dbGet(MEETINGS_KEY);
  return raw ? (unseal<StoredMeeting[]>(raw) ?? []) : [];
}

export async function addMeeting(m: StoredMeeting): Promise<void> {
  // Two people, low traffic: a read-modify-write of one encrypted list is enough.
  const all = await readMeetings();
  await dbSet(MEETINGS_KEY, seal([...all.filter((x) => x.id !== m.id), m]));
  await bumpVersion();
}

/* ------------------------------- Time off ------------------------------- */

export type StoredTimeOff = TimeOffBlock & { personId: string };

export async function readTimeOff(): Promise<StoredTimeOff[]> {
  const raw = await dbGet(TIMEOFF_KEY);
  return raw ? (unseal<StoredTimeOff[]>(raw) ?? []) : [];
}

export async function addTimeOff(b: StoredTimeOff): Promise<void> {
  const all = await readTimeOff();
  await dbSet(TIMEOFF_KEY, seal([...all.filter((x) => x.id !== b.id), b]));
  await bumpVersion();
}

/** Removes one of a person's own blocks (someone else's id is ignored). */
export async function removeTimeOff(personId: string, id: string): Promise<void> {
  const all = await readTimeOff();
  const next = all.filter((x) => !(x.id === id && x.personId === personId));
  if (next.length === all.length) return;
  await dbSet(TIMEOFF_KEY, seal(next));
  await bumpVersion();
}
