/**
 * iCloud Calendar over CalDAV (the standard Apple Calendar uses).
 *
 * Apple has no OAuth for calendars: the person creates an app-specific password at
 * appleid.apple.com and enters it once, alongside their Apple ID. We store it encrypted
 * and use HTTP Basic auth against caldav.icloud.com. Revoking it at Apple ends access.
 */
import "server-only";
import { fromZonedTime } from "date-fns-tz";
import type { LiveSession } from "./session";

const ROOT = "https://caldav.icloud.com/";

export class ICloudAuthError extends Error {}

type Cal = { url: string; name: string };

const basic = (appleId: string, password: string) => `Basic ${Buffer.from(`${appleId}:${password}`).toString("base64")}`;

async function dav(method: string, url: string, auth: string, body: string, depth: "0" | "1"): Promise<string> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, Depth: depth, "Content-Type": "application/xml; charset=utf-8" },
    body,
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new ICloudAuthError("Apple ID or app-specific password was not accepted");
  if (!res.ok && res.status !== 207) throw new Error(`iCloud ${method} failed (${res.status})`);
  return res.text();
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#13;/g, "\r")
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&");

/** Text of the first <prefix:tag> element, namespace prefix optional. */
const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`))?.[1];
const responses = (xml: string) => xml.match(/<(?:[\w-]+:)?response[\s>][\s\S]*?<\/(?:[\w-]+:)?response>/g) ?? [];

/** Finds the calendars of an Apple ID. Throws ICloudAuthError if the credentials are wrong. */
export async function discoverCalendars(appleId: string, password: string): Promise<Cal[]> {
  const auth = basic(appleId, password);
  const principalXml = await dav(
    "PROPFIND",
    ROOT,
    auth,
    '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
    "0",
  );
  const principalHref = tag(tag(principalXml, "current-user-principal") ?? "", "href");
  if (!principalHref) throw new Error("iCloud did not return a calendar account");
  const principal = new URL(principalHref.trim(), ROOT).toString();

  const homeXml = await dav(
    "PROPFIND",
    principal,
    auth,
    '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>',
    "0",
  );
  const homeHref = tag(tag(homeXml, "calendar-home-set") ?? "", "href");
  if (!homeHref) throw new Error("iCloud did not return a calendar home");
  const home = new URL(homeHref.trim(), principal).toString();

  const listXml = await dav(
    "PROPFIND",
    home,
    auth,
    '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>',
    "1",
  );
  return responses(listXml)
    .filter((r) => /<(?:[\w-]+:)?calendar\s*\/>/.test(tag(r, "resourcetype") ?? ""))
    .filter((r) => {
      const comps = tag(r, "supported-calendar-component-set");
      return !comps || /name="VEVENT"/.test(comps);
    })
    .map((r) => ({ url: new URL((tag(r, "href") ?? "").trim(), home).toString(), name: unxml(tag(r, "displayname") ?? "Calendar").trim() }));
}

/* ----------------------------------- ICS ----------------------------------- */

type Prop = { params: Record<string, string>; value: string };

/** Splits unfolded ICS text into VEVENT property maps. */
export function parseVevents(ics: string): Record<string, Prop>[] {
  const lines = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: Record<string, Prop>[] = [];
  let cur: Record<string, Prop> | null = null;
  let depth = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("BEGIN:")) depth++; // e.g. VALARM inside the event
    else if (line === "END:VEVENT") {
      out.push(cur);
      cur = null;
    } else if (line.startsWith("END:")) depth--;
    else if (depth === 0) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const [name, ...paramParts] = line.slice(0, i).split(";");
      const params = Object.fromEntries(paramParts.map((p) => p.split("=") as [string, string]));
      if (!(name.toUpperCase() in cur)) cur[name.toUpperCase()] = { params, value: line.slice(i + 1) };
    }
  }
  return out;
}

/** An ICS date-time as epoch ms, or null for all-day dates. */
export function icsTime(p: Prop | undefined): number | null {
  if (!p || p.params.VALUE === "DATE" || /^\d{8}$/.test(p.value)) return null;
  const m = p.value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7] === "Z") return Date.parse(`${local}Z`);
  const tz = p.params.TZID?.replace(/^"|"$/g, "");
  try {
    return tz ? fromZonedTime(local, tz).getTime() : Date.parse(`${local}Z`);
  } catch {
    return Date.parse(`${local}Z`);
  }
}

function durationMs(v: string | undefined): number {
  const m = v?.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, w, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return ((((w * 7 + d) * 24 + h) * 60 + min) * 60 + s) * 1000;
}

const icsDate = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const unIcsText = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/* --------------------------------- Adapter --------------------------------- */

export type ICloudExtra = { password: string; calendars: Cal[] };
const extra = (s: LiveSession) => s.extra as ICloudExtra;

/** Busy events in [startIso, endIso) across all of the person's iCloud calendars. */
export async function listICloudEvents(s: LiveSession, startIso: string, endIso: string) {
  const { password, calendars } = extra(s);
  const auth = basic(s.email, password);
  const start = icsDate(startIso);
  const end = icsDate(endIso);
  const from = Date.parse(startIso);
  const to = Date.parse(endIso);
  const body =
    '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
    `<d:prop><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter>` +
    "</c:calendar-query>";

  const perCalendar = await Promise.all(
    calendars.map(async (cal) => {
      const xml = await dav("REPORT", cal.url, auth, body, "1");
      return responses(xml).flatMap((r) => parseVevents(unxml(tag(r, "calendar-data") ?? "")));
    }),
  );
  return perCalendar
    .flat()
    .map((ev) => {
      const startMs = icsTime(ev.DTSTART);
      const endMs = icsTime(ev.DTEND) ?? (startMs !== null ? startMs + durationMs(ev.DURATION?.value) : null);
      return { ev, startMs, endMs };
    })
    .filter(
      ({ ev, startMs, endMs }) =>
        // Same rules as Google/Outlook: timed, not cancelled, not marked free, inside the range.
        startMs !== null &&
        endMs !== null &&
        endMs > startMs &&
        ev.STATUS?.value !== "CANCELLED" &&
        ev.TRANSP?.value !== "TRANSPARENT" &&
        startMs < to &&
        endMs > from,
    )
    .map(({ ev, startMs, endMs }) => ({
      id: `${ev.UID?.value ?? "event"}:${startMs}`,
      startUtc: new Date(startMs!).toISOString(),
      endUtc: new Date(endMs!).toISOString(),
      title: unIcsText(ev.SUMMARY?.value ?? "(No title)"),
    }));
}

/** Creates an event in the person's first iCloud calendar. */
export async function createICloudEvent(
  s: LiveSession,
  e: { title: string; startUtc: string; endUtc: string; description: string },
): Promise<{ id: string }> {
  const { password, calendars } = extra(s);
  const cal = calendars[0];
  if (!cal) throw new Error("No iCloud calendar to add the meeting to");
  const uid = `fiutran-${crypto.randomUUID()}`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fiutran//Scheduler//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(e.startUtc)}`,
    `DTEND:${icsDate(e.endUtc)}`,
    `SUMMARY:${icsText(e.title)}`,
    `DESCRIPTION:${icsText(e.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const res = await fetch(new URL(`${uid}.ics`, cal.url.endsWith("/") ? cal.url : `${cal.url}/`).toString(), {
    method: "PUT",
    headers: { Authorization: basic(s.email, password), "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" },
    body: ics,
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new ICloudAuthError("iCloud access was revoked; connect again");
  if (!res.ok) throw new Error(`iCloud create failed (${res.status})`);
  return { id: uid };
}
