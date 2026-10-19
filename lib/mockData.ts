/**
 * SAMPLE DATA ONLY. Replaced by Microsoft Graph / Google Calendar responses
 * once real connections exist; nothing outside lib/calendarSource.ts imports it.
 *
 * Events are written in each person's own local time (how they'd see them in
 * their own calendar) and converted to UTC with real IANA zones, so daylight
 * saving is handled correctly whichever week the demo runs in.
 */
import type { BusyEvent, CalendarProvider, Person } from "./types";
import { zonedToUtc } from "./time";
import { getDemoWeek } from "./week";

const h = (hhmm: string) => {
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm;
};

export const MOCK_PEOPLE: Person[] = [
  {
    id: "ananya",
    name: "Ananya Rao",
    firstName: "Ananya",
    city: "Delhi",
    timeZone: "Asia/Kolkata",
    workStartMin: h("10:00"),
    workEndMin: h("19:00"),
    workDays: [1, 2, 3, 4, 5],
    calendar: "outlook",
    email: "ananya.rao@fiutran.example",
    isMe: true,
  },
  {
    id: "rohan",
    name: "Rohan Mehta",
    firstName: "Rohan",
    city: "Bengaluru",
    timeZone: "Asia/Kolkata",
    workStartMin: h("09:30"),
    workEndMin: h("18:30"),
    workDays: [1, 2, 3, 4, 5],
    calendar: "google",
    email: "rohan.mehta@fiutran.example",
  },
  {
    id: "lena",
    name: "Lena Fischer",
    firstName: "Lena",
    city: "Frankfurt",
    timeZone: "Europe/Berlin",
    workStartMin: h("09:00"),
    workEndMin: h("17:30"),
    workDays: [1, 2, 3, 4, 5],
    calendar: "outlook",
    email: "lena.fischer@fiutran.example",
  },
  {
    id: "arjun",
    name: "Arjun Patel",
    firstName: "Arjun",
    city: "London",
    timeZone: "Europe/London",
    workStartMin: h("09:00"),
    workEndMin: h("17:30"),
    workDays: [1, 2, 3, 4, 5],
    calendar: "google",
    email: "arjun.patel@fiutran.example",
  },
  {
    id: "maya",
    name: "Maya Brooks",
    firstName: "Maya",
    city: "New York",
    timeZone: "America/New_York",
    workStartMin: h("09:00"),
    workEndMin: h("17:00"),
    workDays: [1, 2, 3, 4, 5],
    calendar: "outlook",
    email: "maya.brooks@fiutran.example",
  },
];

/** [weekday 0=Mon..4=Fri | "all", start, end, title, provider?] in the person's local time. */
type Row = [number | "all", string, string, string, CalendarProvider?];

const SCHEDULES: Record<string, Row[]> = {
  ananya: [
    ["all", "10:00", "10:30", "Team standup"],
    ["all", "13:00", "14:00", "Lunch"],
    [0, "11:00", "12:00", "Client call: Northwind"],
    [0, "15:00", "15:30", "Hiring sync"],
    [1, "11:30", "12:30", "Roadmap review"],
    [1, "14:30", "15:00", "Budget check-in"],
    [1, "15:30", "16:30", "Client call: Tata Steel"],
    [2, "11:00", "12:30", "Focus time"],
    [2, "18:00", "18:30", "Weekly report"],
    [3, "12:00", "13:00", "Client call: Contoso"],
    [3, "14:00", "15:00", "Design review"],
    [4, "11:00", "12:00", "Focus time"],
    [4, "16:00", "17:00", "Ops review"],
    // Personal Google calendar: only visible once Google is connected on My profile.
    [2, "16:00", "17:00", "Dentist appointment", "google"],
    [4, "18:30", "19:00", "School pickup", "google"],
  ],
  rohan: [
    ["all", "10:00", "10:30", "Team standup"],
    ["all", "13:00", "13:45", "Lunch"],
    [0, "11:00", "12:30", "Focus time"],
    [0, "14:00", "14:30", "Code review"],
    [1, "11:00", "12:00", "Client call: Infosys"],
    [1, "16:30", "18:00", "Focus time"],
    [2, "11:00", "12:00", "Focus time"],
    [2, "14:00", "14:30", "Bug triage"],
    [3, "10:30", "12:00", "Focus time"],
    [3, "15:00", "16:00", "Sprint planning"],
    [4, "11:30", "12:30", "Vendor call"],
    [4, "18:00", "18:30", "Release check"],
  ],
  lena: [
    ["all", "09:00", "09:30", "Team check-in"],
    ["all", "13:00", "14:00", "Lunch"],
    [0, "15:00", "16:00", "Client call: Siemens"],
    [1, "15:00", "16:00", "Supplier call"],
    [2, "12:00", "12:30", "Quality review"],
    [2, "15:30", "17:00", "Focus time"],
    [3, "10:30", "11:00", "Partner sync"],
    [3, "15:00", "16:30", "Focus time"],
    [4, "14:30", "15:00", "Weekly wrap-up"],
  ],
  arjun: [
    ["all", "12:30", "13:30", "Lunch"],
    [0, "09:00", "09:30", "Inbox and planning"],
    [0, "14:00", "15:00", "Client call: Barclays"],
    [1, "15:00", "16:30", "Focus time"],
    [2, "14:00", "15:00", "Vendor demo"],
    [3, "10:00", "11:00", "Hiring panel"],
    [3, "15:30", "16:00", "1:1 with Lena"],
    [4, "15:00", "16:00", "Focus time"],
  ],
  maya: [
    ["all", "09:30", "10:00", "US standup"],
    ["all", "12:00", "13:00", "Lunch"],
    [0, "10:00", "11:00", "Client call: Acme"],
    [1, "13:00", "14:30", "Focus time"],
    [2, "11:00", "12:00", "Client call: Globex"],
    [3, "14:00", "15:00", "Pipeline review"],
    [4, "10:00", "11:00", "Focus time"],
  ],
};

let cache: BusyEvent[] | null = null;

/** Expands the weekly templates into concrete UTC events for the demo week. */
export function buildMockEvents(): BusyEvent[] {
  if (cache) return cache;
  const week = getDemoWeek();
  const people = new Map(MOCK_PEOPLE.map((p) => [p.id, p]));
  const out: BusyEvent[] = [];
  for (const [personId, rows] of Object.entries(SCHEDULES)) {
    const person = people.get(personId)!;
    rows.forEach(([day, start, end, title, provider], rowIdx) => {
      const days = day === "all" ? [0, 1, 2, 3, 4] : [day];
      for (const d of days) {
        out.push({
          id: `${personId}-${rowIdx}-${d}`,
          personId,
          startUtc: new Date(zonedToUtc(week[d], h(start), person.timeZone)).toISOString(),
          endUtc: new Date(zonedToUtc(week[d], h(end), person.timeZone)).toISOString(),
          title,
          source: provider ?? person.calendar,
        });
      }
    });
  }
  cache = out;
  return out;
}
