/**
 * The Fiutran team. Busy times come only from each person's connected calendar
 * (or meetings and time off created in the app); nothing here is invented.
 *
 * Whoever connects a calendar in their browser is matched to their row by email.
 * Profile changes (time zone, hours) are per browser until the shared database exists.
 */
import type { Person } from "./types";

const h = (hhmm: string) => {
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm;
};

export const TEAM: Person[] = [
  {
    id: "diksha",
    name: "Diksha Sharma",
    firstName: "Diksha",
    city: "India",
    timeZone: "Asia/Kolkata",
    workStartMin: h("10:00"),
    workEndMin: h("19:00"),
    workDays: [1, 2, 3, 4, 5],
    calendar: "google",
    email: "ms.dikshasharmaa@gmail.com",
    // Default "you" when nobody has connected a calendar in this browser.
    isMe: true,
  },
  {
    id: "aarti",
    name: "Aarti",
    firstName: "Aarti",
    city: "Bengaluru",
    timeZone: "Asia/Kolkata",
    workStartMin: h("09:30"),
    workEndMin: h("18:30"),
    workDays: [1, 2, 3, 4, 5],
    // fiutran.com mail is on Microsoft 365.
    calendar: "outlook",
    email: "letstalk@fiutran.com",
  },
];
