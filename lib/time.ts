import { formatInTimeZone, fromZonedTime, getTimezoneOffset } from "date-fns-tz";
import { addDaysIso } from "./week";

export const SLOT_MIN = 30;
export const SLOT_MS = SLOT_MIN * 60_000;

/** Time zones offered in the "Show times in" switcher. */
export const VIEWER_ZONES = [
  { tz: "Asia/Kolkata", label: "India" },
  { tz: "Europe/Berlin", label: "Frankfurt" },
  { tz: "Europe/London", label: "London" },
  { tz: "America/New_York", label: "New York" },
] as const;

/** Time zones offered on the profile screen. */
export const PROFILE_ZONES = [
  { tz: "Asia/Kolkata", label: "India (Kolkata)" },
  { tz: "Asia/Dubai", label: "Dubai" },
  { tz: "Asia/Singapore", label: "Singapore" },
  { tz: "Europe/Berlin", label: "Frankfurt / Berlin" },
  { tz: "Europe/London", label: "London" },
  { tz: "America/New_York", label: "New York" },
  { tz: "America/Los_Angeles", label: "Los Angeles" },
  { tz: "Australia/Sydney", label: "Sydney" },
];

/** [standard, daylight] abbreviations. Intl gives "GMT+5:30" for many zones, so we name them ourselves. */
const ABBR: Record<string, [string, string]> = {
  "Asia/Kolkata": ["IST", "IST"],
  "Asia/Dubai": ["GST", "GST"],
  "Asia/Singapore": ["SGT", "SGT"],
  "Europe/Berlin": ["CET", "CEST"],
  "Europe/London": ["GMT", "BST"],
  "America/New_York": ["EST", "EDT"],
  "America/Los_Angeles": ["PST", "PDT"],
  "Australia/Sydney": ["AEST", "AEDT"],
};

export function isDst(tz: string, at: Date | number): boolean {
  const year = new Date(at).getUTCFullYear();
  const jan = getTimezoneOffset(tz, new Date(Date.UTC(year, 0, 1)));
  const jul = getTimezoneOffset(tz, new Date(Date.UTC(year, 6, 1)));
  return jan !== jul && getTimezoneOffset(tz, new Date(at)) > Math.min(jan, jul);
}

export function tzAbbr(tz: string, at: Date | number = Date.now()): string {
  const pair = ABBR[tz];
  if (pair) return pair[isDst(tz, at) ? 1 : 0];
  return formatInTimeZone(new Date(at), tz, "zzz");
}

/** Cached Intl formatters: fast local weekday + minute-of-day lookups for the grid. */
const partsFormatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(ms: number, tz: string): { isoDay: number; minute: number } {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(tz, f);
  }
  let isoDay = 1;
  let h = 0;
  let m = 0;
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type === "weekday") isoDay = WEEKDAY[p.value];
    else if (p.type === "hour") h = Number(p.value);
    else if (p.type === "minute") m = Number(p.value);
  }
  return { isoDay, minute: h * 60 + m };
}

/** UTC ms for a wall-clock time ("yyyy-MM-dd", minutes after midnight) in a zone. */
export function zonedToUtc(dateIso: string, minute: number, tz: string): number {
  const day = minute >= 1440 ? addDaysIso(dateIso, 1) : dateIso;
  const m = minute % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return fromZonedTime(`${day}T${hh}:${mm}:00`, tz).getTime();
}

/** Start/end of a calendar day in a zone, as UTC ms. Handles 23h/25h DST days. */
export function dayBounds(dateIso: string, tz: string): { start: number; end: number } {
  return { start: zonedToUtc(dateIso, 0, tz), end: zonedToUtc(addDaysIso(dateIso, 1), 0, tz) };
}

/** 30-minute cell start times (UTC ms) covering one day in the viewer's zone. */
export function dayCells(dateIso: string, tz: string): number[] {
  const { start, end } = dayBounds(dateIso, tz);
  const cells: number[] = [];
  for (let t = start; t < end; t += SLOT_MS) cells.push(t);
  return cells;
}

export const fmtTime = (ms: number | Date, tz: string) => formatInTimeZone(new Date(ms), tz, "HH:mm");
export const fmtDate = (ms: number | Date, tz: string) => formatInTimeZone(new Date(ms), tz, "EEE d MMM");
export const fmtDateLong = (ms: number | Date, tz: string) =>
  formatInTimeZone(new Date(ms), tz, "EEEE d MMMM yyyy");
export const localDateIso = (ms: number | Date, tz: string) => formatInTimeZone(new Date(ms), tz, "yyyy-MM-dd");

export function fmtRange(start: number, end: number, tz: string): string {
  return `${fmtTime(start, tz)}–${fmtTime(end, tz)} ${tzAbbr(tz, start)}`;
}

/** Minutes-after-midnight to "HH:mm" (1440 shows as 24:00). */
export function minToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return `${h} hr`;
}

/** Human-readable difference between two zones, e.g. "3h 30m behind". */
export function offsetDiffLabel(tz: string, relativeTo: string, at: number): string {
  const diffMin = (getTimezoneOffset(tz, new Date(at)) - getTimezoneOffset(relativeTo, new Date(at))) / 60_000;
  if (diffMin === 0) return "Same time";
  const abs = Math.abs(diffMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const amount = `${h ? `${h}h` : ""}${h && m ? " " : ""}${m ? `${m}m` : ""}`;
  return `${amount} ${diffMin > 0 ? "ahead" : "behind"}`;
}
