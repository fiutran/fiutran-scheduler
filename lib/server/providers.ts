/**
 * Server-side adapters for real calendars. Each one knows how to sign in, refresh tokens,
 * read busy events and create a meeting. Routes in app/api/[provider]/* are provider-agnostic.
 *
 * Env vars (Vercel → Settings → Environment Variables):
 *   AUTH_SECRET                                   – encrypts the session cookies (both providers)
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET        – Google Calendar
 *   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET  – Outlook / Microsoft 365
 *   MICROSOFT_TENANT (optional, default "common") – "common" = personal and work accounts
 */
import "server-only";
import { graphRecurrence, localDateTime, occurrences, rrule, type Recurrence } from "@/lib/recurrence";
import { createICloudEvent, ICloudAuthError, listICloudEvents } from "./icloud";
import { idTokenClaims, type LiveSession } from "./session";
import { dbConfigured, readConn, writeConn } from "./store";
import type { CalendarProvider } from "@/lib/types";

export class NotConnectedError extends Error {}

export type LiveEvent = { id: string; startUtc: string; endUtc: string; title: string; link?: string };
export type NewEvent = {
  title: string;
  startUtc: string;
  endUtc: string;
  description: string;
  /** Present for a repeating series; times are anchored to recurrence.timeZone. */
  recurrence?: Recurrence;
};

type Tokens = { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope?: string };

export type Provider = {
  id: CalendarProvider;
  label: string;
  /** "oauth": sign in at the provider. "password": iCloud's Apple ID + app-specific password. */
  kind: "oauth" | "password";
  configured: () => boolean;
  authorizeUrl: (redirectUri: string, state: string) => string;
  exchangeCode: (code: string, redirectUri: string) => Promise<Tokens>;
  refresh: (refreshToken: string) => Promise<Tokens>;
  /** Whether the granted scopes include calendar read/write. */
  hasCalendarScope: (t: Tokens) => boolean;
  profile: (t: Tokens) => Promise<{ email?: string; name?: string; firstName?: string }>;
  listEvents: (s: LiveSession, startIso: string, endIso: string) => Promise<LiveEvent[]>;
  createEvent: (s: LiveSession, e: NewEvent) => Promise<{ id: string; link?: string }>;
  revoke: (s: LiveSession) => Promise<void>;
};

async function tokenRequest(url: string, params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function api(url: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (res.status === 401) throw new NotConnectedError("Access was revoked; connect again");
  return res;
}

/* ---------------------------------- Google ---------------------------------- */

const GOOGLE_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.events"];

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

const google: Provider = {
  id: "google",
  label: "Google Calendar",
  kind: "oauth",
  configured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET),
  authorizeUrl: (redirectUri, state) =>
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }),
  exchangeCode: (code, redirectUri) =>
    tokenRequest("https://oauth2.googleapis.com/token", {
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  refresh: (refreshToken) =>
    tokenRequest("https://oauth2.googleapis.com/token", {
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  hasCalendarScope: (t) => /calendar\.events/.test(t.scope ?? ""),
  async profile(t) {
    let c = idTokenClaims(t.id_token);
    // Some sign-ins return an id_token without name claims; ask Google directly in that case.
    if (!c.name) {
      const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${t.access_token}` },
        cache: "no-store",
      }).catch(() => null);
      if (res?.ok) c = { ...c, ...(await res.json()) };
    }
    return { email: c.email, name: c.name, firstName: c.given_name };
  },
  async listEvents(s, startIso, endIso) {
    const accessToken = s.accessToken;
    const items: GEvent[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({
        timeMin: startIso,
        timeMax: endIso,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, accessToken);
      if (!res.ok) throw new Error(`events.list ${res.status}: ${await res.text()}`);
      const page = (await res.json()) as { items?: GEvent[]; nextPageToken?: string };
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return (
      items
        // Busy only: timed, not cancelled, not marked "Free", not declined by you. All-day events are skipped.
        .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent" && e.start?.dateTime && e.end?.dateTime)
        .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === "declined"))
        .map((e) => ({
          id: e.id,
          startUtc: new Date(e.start!.dateTime!).toISOString(),
          endUtc: new Date(e.end!.dateTime!).toISOString(),
          title: e.summary ?? "(No title)",
          link: e.htmlLink,
        }))
    );
  },
  async createEvent(s, e) {
    const res = await api("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none", s.accessToken, {
      method: "POST",
      body: JSON.stringify({
        summary: e.title,
        description: e.description,
        // A series needs local time + zone so it stays at the same local time across DST.
        ...(e.recurrence
          ? {
              start: { dateTime: localDateTime(Date.parse(e.startUtc), e.recurrence.timeZone), timeZone: e.recurrence.timeZone },
              end: { dateTime: localDateTime(Date.parse(e.endUtc), e.recurrence.timeZone), timeZone: e.recurrence.timeZone },
              recurrence: [rrule(e.recurrence)],
            }
          : { start: { dateTime: e.startUtc }, end: { dateTime: e.endUtc } }),
        extendedProperties: { private: { fiutranScheduler: "1" } },
      }),
    });
    if (!res.ok) throw new Error(`events.insert ${res.status}: ${await res.text()}`);
    const created = (await res.json()) as GEvent;
    return { id: created.id, link: created.htmlLink };
  },
  async revoke(s) {
    const token = s.refreshToken ?? s.accessToken;
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(
      () => undefined,
    );
  },
};

/* --------------------------- Outlook (Microsoft Graph) --------------------------- */

const MS_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadWrite"];
const msTenant = () => process.env.MICROSOFT_TENANT || "common";
const msBase = () => `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0`;

type MsDateTime = { dateTime: string; timeZone: string };
type MsEvent = {
  id: string;
  subject?: string;
  webLink?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  start: MsDateTime;
  end: MsDateTime;
  responseStatus?: { response?: string };
};

/** Windows time-zone names, which Outlook always accepts (IANA names are passed through for anything else). */
const WINDOWS_ZONES: Record<string, string> = {
  "Asia/Kolkata": "India Standard Time",
  "Asia/Dubai": "Arabian Standard Time",
  "Asia/Singapore": "Singapore Standard Time",
  "Europe/Berlin": "W. Europe Standard Time",
  "Europe/London": "GMT Standard Time",
  "America/New_York": "Eastern Standard Time",
  "America/Los_Angeles": "Pacific Standard Time",
  "Australia/Sydney": "AUS Eastern Standard Time",
};
const windowsZone = (iana: string) => WINDOWS_ZONES[iana] ?? iana;

// With Prefer: outlook.timezone="UTC", Graph returns UTC wall times without a zone suffix.
const msUtc = (d: MsDateTime) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(d.dateTime) ? d.dateTime : `${d.dateTime}Z`).toISOString();

const outlook: Provider = {
  id: "outlook",
  label: "Outlook",
  kind: "oauth",
  configured: () =>
    Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.AUTH_SECRET),
  authorizeUrl: (redirectUri, state) =>
    `${msBase()}/authorize?` +
    new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: MS_SCOPES.join(" "),
      prompt: "select_account",
      state,
    }),
  exchangeCode: (code, redirectUri) =>
    tokenRequest(`${msBase()}/token`, {
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope: MS_SCOPES.join(" "),
    }),
  refresh: (refreshToken) =>
    tokenRequest(`${msBase()}/token`, {
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MS_SCOPES.join(" "),
    }),
  hasCalendarScope: (t) => /calendars\.readwrite/i.test(t.scope ?? ""),
  async profile(t) {
    const c = idTokenClaims(t.id_token);
    const res = await api("https://graph.microsoft.com/v1.0/me?$select=displayName,givenName,mail,userPrincipalName", t.access_token).catch(
      () => null,
    );
    const me = res?.ok
      ? ((await res.json()) as { displayName?: string; givenName?: string; mail?: string; userPrincipalName?: string })
      : {};
    return {
      email: me.mail || me.userPrincipalName || c.email || c.preferred_username,
      name: me.displayName || c.name,
      firstName: me.givenName || undefined,
    };
  },
  async listEvents(s, startIso, endIso) {
    const accessToken = s.accessToken;
    const items: MsEvent[] = [];
    let url: string | undefined =
      "https://graph.microsoft.com/v1.0/me/calendarView?" +
      new URLSearchParams({
        startDateTime: startIso,
        endDateTime: endIso,
        $select: "subject,start,end,showAs,isAllDay,isCancelled,responseStatus,webLink",
        $orderby: "start/dateTime",
        $top: "250",
      });
    while (url) {
      const res = await api(url, accessToken, { headers: { Prefer: 'outlook.timezone="UTC"' } });
      if (!res.ok) throw new Error(`calendarView ${res.status}: ${await res.text()}`);
      const page = (await res.json()) as { value?: MsEvent[]; "@odata.nextLink"?: string };
      items.push(...(page.value ?? []));
      url = page["@odata.nextLink"];
    }
    return (
      items
        // Same rules as Google: timed, not cancelled, not shown as free, not declined.
        .filter((e) => !e.isCancelled && !e.isAllDay && e.showAs !== "free" && e.responseStatus?.response !== "declined")
        .map((e) => ({ id: e.id, startUtc: msUtc(e.start), endUtc: msUtc(e.end), title: e.subject || "(No title)", link: e.webLink }))
    );
  },
  async createEvent(s, e) {
    // No attendees are added, so Outlook sends no invitations.
    const res = await api("https://graph.microsoft.com/v1.0/me/events", s.accessToken, {
      method: "POST",
      body: JSON.stringify({
        subject: e.title,
        body: { contentType: "text", content: e.description },
        ...(e.recurrence
          ? {
              start: { dateTime: localDateTime(Date.parse(e.startUtc), e.recurrence.timeZone), timeZone: windowsZone(e.recurrence.timeZone) },
              end: { dateTime: localDateTime(Date.parse(e.endUtc), e.recurrence.timeZone), timeZone: windowsZone(e.recurrence.timeZone) },
              recurrence: (() => {
                const r = graphRecurrence(Date.parse(e.startUtc), e.recurrence);
                return { ...r, range: { ...r.range, recurrenceTimeZone: windowsZone(e.recurrence.timeZone) } };
              })(),
            }
          : {
              start: { dateTime: e.startUtc.replace("Z", ""), timeZone: "UTC" },
              end: { dateTime: e.endUtc.replace("Z", ""), timeZone: "UTC" },
            }),
        showAs: "busy",
      }),
    });
    if (!res.ok) throw new Error(`events.create ${res.status}: ${await res.text()}`);
    const created = (await res.json()) as MsEvent;
    return { id: created.id, link: created.webLink };
  },
  // Microsoft has no token-revoke endpoint for this flow; forgetting the tokens ends the connection.
  revoke: async () => undefined,
};

/* -------------------------------- iCloud (CalDAV) -------------------------------- */

const noOauth = () => {
  throw new Error("iCloud connects with an Apple ID and app-specific password, not a sign-in page");
};

const icloud: Provider = {
  id: "icloud",
  label: "iCloud Calendar",
  kind: "password",
  // The app-specific password must be stored server-side, so iCloud needs the shared database.
  configured: () => dbConfigured(),
  authorizeUrl: noOauth,
  exchangeCode: noOauth,
  refresh: noOauth,
  hasCalendarScope: () => true,
  profile: async () => ({}),
  async listEvents(s, startIso, endIso) {
    try {
      return await listICloudEvents(s, startIso, endIso);
    } catch (err) {
      if (err instanceof ICloudAuthError) throw new NotConnectedError(err.message);
      throw err;
    }
  },
  async createEvent(s, e) {
    try {
      // Separate events per date: exact times without hand-written VTIMEZONE data.
      if (!e.recurrence) return await createICloudEvent(s, e);
      const created = [];
      for (const o of occurrences(Date.parse(e.startUtc), Date.parse(e.endUtc), e.recurrence)) {
        created.push(await createICloudEvent(s, { ...e, startUtc: new Date(o.start).toISOString(), endUtc: new Date(o.end).toISOString() }));
      }
      return created[0];
    } catch (err) {
      if (err instanceof ICloudAuthError) throw new NotConnectedError(err.message);
      throw err;
    }
  },
  // Access ends when the app-specific password is revoked at appleid.apple.com; we just forget it.
  revoke: async () => undefined,
};

export const PROVIDERS: Record<CalendarProvider, Provider> = { google, outlook, icloud };

export function getProvider(id: string): Provider | null {
  return id === "google" || id === "outlook" || id === "icloud" ? PROVIDERS[id] : null;
}

/**
 * A valid connection, refreshing the access token when it's about to expire.
 * `personId` reads a teammate's connection from the shared database (server-side only).
 */
export async function activeSession(p: Provider, personId?: string | null): Promise<LiveSession> {
  const session = await readConn(p.id, personId);
  if (!session) throw new NotConnectedError(`${p.label} is not connected`);
  if (p.kind === "password" || session.expiresAt - 60_000 > Date.now()) return session;
  if (!session.refreshToken) throw new NotConnectedError(`${p.label} session expired; connect again`);
  const t = await p.refresh(session.refreshToken);
  const next: LiveSession = {
    ...session,
    accessToken: t.access_token,
    // Microsoft rotates refresh tokens; keep the newest one.
    refreshToken: t.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + t.expires_in * 1000,
  };
  await writeConn(p.id, next, personId);
  return next;
}

/** Fills in a missing name on an older session. */
export async function ensureName(p: Provider, session: LiveSession): Promise<LiveSession> {
  if (session.name || p.kind === "password") return session;
  try {
    const fresh = await activeSession(p);
    const info = await p.profile({ access_token: fresh.accessToken, expires_in: 0 });
    if (!info.name) return fresh;
    const next = { ...fresh, name: info.name, firstName: info.firstName };
    await writeConn(p.id, next);
    return next;
  } catch {
    return session;
  }
}
