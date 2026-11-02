/**
 * Repeating meetings. A series is anchored to the organiser's time zone, so
 * "every Monday 10:00" stays at 10:00 local time across daylight-saving changes.
 */
import { formatInTimeZone } from "date-fns-tz";
import { localDateIso, zonedToUtc } from "./time";
import { addDaysIso, isoWeekday } from "./week";

export type RepeatFreq = "daily" | "weekdays" | "weekly" | "biweekly" | "monthly";
export type Recurrence = { freq: RepeatFreq; count: number; timeZone: string };

export const REPEAT_FREQS: RepeatFreq[] = ["weekdays", "daily", "weekly", "biweekly", "monthly"];
export const MAX_OCCURRENCES = 52;

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Dropdown label for a frequency, given the first meeting's date (yyyy-MM-dd). */
export function repeatLabel(freq: RepeatFreq, firstDate: string): string {
  const day = DAY_NAMES[isoWeekday(firstDate) - 1];
  const dom = Number(firstDate.slice(8, 10));
  return {
    daily: "Daily",
    weekdays: "Every weekday (Mon–Fri)",
    weekly: `Weekly on ${day}`,
    biweekly: `Every 2 weeks on ${day}`,
    monthly: `Monthly on day ${dom}`,
  }[freq];
}

export function isValidRecurrence(r: unknown): r is Recurrence {
  const x = r as Recurrence;
  if (!x || !REPEAT_FREQS.includes(x.freq) || !Number.isInteger(x.count) || x.count < 2 || x.count > MAX_OCCURRENCES) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: x.timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Every occurrence of a series as UTC ms ranges, starting with the first meeting. */
export function occurrences(startMs: number, endMs: number, r: Recurrence): { start: number; end: number }[] {
  const dur = endMs - startMs;
  const firstDate = localDateIso(startMs, r.timeZone);
  const minute = Number(formatInTimeZone(startMs, r.timeZone, "H")) * 60 + Number(formatInTimeZone(startMs, r.timeZone, "m"));
  const dom = Number(firstDate.slice(8, 10));
  const dates: string[] = [];
  let date = firstDate;
  for (let guard = 0; dates.length < r.count && guard < 2000; guard++) {
    if (r.freq === "monthly") {
      // Same day each month; months without that day (e.g. the 31st) are skipped, as calendars do.
      const y = Number(firstDate.slice(0, 4));
      const m = Number(firstDate.slice(5, 7)) - 1 + guard;
      const candidate = new Date(Date.UTC(y, m, dom));
      if (candidate.getUTCDate() === dom) dates.push(candidate.toISOString().slice(0, 10));
      continue;
    }
    if (r.freq !== "weekdays" || date === firstDate || isoWeekday(date) <= 5) dates.push(date);
    date = addDaysIso(date, r.freq === "weekly" ? 7 : r.freq === "biweekly" ? 14 : 1);
  }
  return dates.map((d) => {
    const start = zonedToUtc(d, minute, r.timeZone);
    return { start, end: start + dur };
  });
}

/** RFC 5545 rule, as used by Google Calendar. */
export function rrule(r: Recurrence): string {
  const base = {
    daily: "FREQ=DAILY",
    weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    weekly: "FREQ=WEEKLY",
    biweekly: "FREQ=WEEKLY;INTERVAL=2",
    monthly: "FREQ=MONTHLY",
  }[r.freq];
  return `RRULE:${base};COUNT=${r.count}`;
}

const GRAPH_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Microsoft Graph recurrence for an event starting at `startMs`. */
export function graphRecurrence(startMs: number, r: Recurrence) {
  const date = localDateIso(startMs, r.timeZone);
  const day = GRAPH_DAYS[isoWeekday(date) - 1];
  const pattern = {
    daily: { type: "daily", interval: 1 },
    weekdays: { type: "weekly", interval: 1, daysOfWeek: GRAPH_DAYS.slice(0, 5), firstDayOfWeek: "monday" },
    weekly: { type: "weekly", interval: 1, daysOfWeek: [day], firstDayOfWeek: "monday" },
    biweekly: { type: "weekly", interval: 2, daysOfWeek: [day], firstDayOfWeek: "monday" },
    monthly: { type: "absoluteMonthly", interval: 1, dayOfMonth: Number(date.slice(8, 10)) },
  }[r.freq];
  return { pattern, range: { type: "numbered", startDate: date, numberOfOccurrences: r.count, recurrenceTimeZone: r.timeZone } };
}

/** Local wall time ("yyyy-MM-ddTHH:mm:ss") of an instant in a zone, for APIs that take dateTime + timeZone. */
export const localDateTime = (ms: number, tz: string) => formatInTimeZone(ms, tz, "yyyy-MM-dd'T'HH:mm:ss");

/** "weekly on Monday, 10 times" for summaries. */
export function recurrenceSummary(r: Recurrence, firstDate: string): string {
  return `${repeatLabel(r.freq, firstDate).replace(/^./, (c) => c.toLowerCase())}, ${r.count} times`;
}
