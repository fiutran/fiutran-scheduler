import { addDays, formatISO, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

/** Home time zone used to decide which week counts as "this week". */
const HOME_TZ = "Asia/Kolkata";

/**
 * Monday–Friday (as yyyy-MM-dd) of the current week. On a weekend we show the
 * coming week instead, so the demo always has working days ahead.
 */
export function getDemoWeek(now: Date = new Date()): string[] {
  const today = formatInTimeZone(now, HOME_TZ, "yyyy-MM-dd");
  const isoDay = Number(formatInTimeZone(now, HOME_TZ, "i")); // 1..7
  const base = parseISO(today);
  const monday = isoDay >= 6 ? addDays(base, 8 - isoDay) : addDays(base, 1 - isoDay);
  return [0, 1, 2, 3, 4].map((i) => formatISO(addDays(monday, i), { representation: "date" }));
}

export function addDaysIso(dateIso: string, days: number): string {
  return formatISO(addDays(parseISO(dateIso), days), { representation: "date" });
}

/** ISO weekday 1 (Mon) … 7 (Sun) of a calendar date. */
export function isoWeekday(dateIso: string): number {
  const d = parseISO(dateIso).getDay();
  return d === 0 ? 7 : d;
}

/** Monday of the week containing a calendar date. */
export function mondayOf(dateIso: string): string {
  return addDaysIso(dateIso, 1 - isoWeekday(dateIso));
}

/** Monday–Friday of the week containing a calendar date. */
export function workWeekOf(dateIso: string): string[] {
  const monday = mondayOf(dateIso);
  return [0, 1, 2, 3, 4].map((i) => addDaysIso(monday, i));
}
