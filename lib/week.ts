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
