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
import type { CalendarProvider, Meeting } from "@/lib/types";
import { dbConfigured, dbDel, dbGet, dbSet } from "./db";
import { clearSession, readMe, readSession, seal, unseal, writeSession, type LiveSession } from "./session";

export { dbConfigured };

const connKey = (personId: string, p: CalendarProvider) => `fs:conn:${personId}:${p}`;
const MEETINGS_KEY = "fs:meetings";

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
  await dbSet(connKey(pid, p), seal(session));
}

export async function clearConn(p: CalendarProvider, personId?: string | null): Promise<void> {
  if (!dbConfigured()) return clearSession(p);
  const pid = personId ?? (await currentPersonId());
  if (pid) await dbDel(connKey(pid, p));
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
}
