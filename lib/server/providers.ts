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
import { idTokenClaims, readSession, writeSession, type LiveSession } from "./session";
import type { CalendarProvider } from "@/lib/types";

export class NotConnectedError extends Error {}

export type LiveEvent = { id: string; startUtc: string; endUtc: string; title: string; link?: string };
export type NewEvent = { title: string; startUtc: string; endUtc: string; description: string };

type Tokens = { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope?: string };

export type Provider = {
  id: CalendarProvider;
  label: string;
  configured: () => boolean;
  authorizeUrl: (redirectUri: string, state: string) => string;
  exchangeCode: (code: string, redirectUri: string) => Promise<Tokens>;
  refresh: (refreshToken: string) => Promise<Tokens>;
  /** Whether the granted scopes include calendar read/write. */
  hasCalendarScope: (t: Tokens) => boolean;
  profile: (t: Tokens) => Promise<{ email?: string; name?: string; firstName?: string }>;
  listEvents: (accessToken: string, startIso: string, endIso: string) => Promise<LiveEvent[]>;
  createEvent: (accessToken: string, e: NewEvent) => Promise<{ id: string; link?: string }>;
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
  async listEvents(accessToken, startIso, endIso) {
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
  async createEvent(accessToken, e) {
    const res = await api("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none", accessToken, {
      method: "POST",
      body: JSON.stringify({
        summary: e.title,
        description: e.description,
        start: { dateTime: e.startUtc },
        end: { dateTime: e.endUtc },
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

// With Prefer: outlook.timezone="UTC", Graph returns UTC wall times without a zone suffix.
const msUtc = (d: MsDateTime) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(d.dateTime) ? d.dateTime : `${d.dateTime}Z`).toISOString();

const outlook: Provider = {
  id: "outlook",
  label: "Outlook",
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
  async listEvents(accessToken, startIso, endIso) {
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
  async createEvent(accessToken, e) {
    // No attendees are added, so Outlook sends no invitations.
    const res = await api("https://graph.microsoft.com/v1.0/me/events", accessToken, {
      method: "POST",
      body: JSON.stringify({
        subject: e.title,
        body: { contentType: "text", content: e.description },
        start: { dateTime: e.startUtc.replace("Z", ""), timeZone: "UTC" },
        end: { dateTime: e.endUtc.replace("Z", ""), timeZone: "UTC" },
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

export const PROVIDERS: Record<CalendarProvider, Provider> = { google, outlook };

export function getProvider(id: string): Provider | null {
  return id === "google" || id === "outlook" ? PROVIDERS[id] : null;
}

/** A valid session for a provider, refreshing the access token when it's about to expire. */
export async function activeSession(p: Provider): Promise<LiveSession> {
  const session = await readSession(p.id);
  if (!session) throw new NotConnectedError(`${p.label} is not connected`);
  if (session.expiresAt - 60_000 > Date.now()) return session;
  if (!session.refreshToken) throw new NotConnectedError(`${p.label} session expired; connect again`);
  const t = await p.refresh(session.refreshToken);
  const next: LiveSession = {
    ...session,
    accessToken: t.access_token,
    // Microsoft rotates refresh tokens; keep the newest one.
    refreshToken: t.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + t.expires_in * 1000,
  };
  await writeSession(p.id, next);
  return next;
}

/** Fills in a missing name on an older session. */
export async function ensureName(p: Provider, session: LiveSession): Promise<LiveSession> {
  if (session.name) return session;
  try {
    const fresh = await activeSession(p);
    const info = await p.profile({ access_token: fresh.accessToken, expires_in: 0 });
    if (!info.name) return fresh;
    const next = { ...fresh, name: info.name, firstName: info.firstName };
    await writeSession(p.id, next);
    return next;
  } catch {
    return session;
  }
}
