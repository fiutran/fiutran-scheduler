/** Calendar providers a person can connect. "local" = created inside Fiutran. */
export type CalendarProvider = "outlook" | "google";

export type Person = {
  id: string;
  name: string;
  firstName: string;
  city: string;
  /** IANA time zone, e.g. "Europe/Berlin". */
  timeZone: string;
  /** Local working hours as minutes after midnight. End may be 1440 (24:00). */
  workStartMin: number;
  workEndMin: number;
  /** ISO weekday numbers: 1 = Monday ... 7 = Sunday. */
  workDays: number[];
  calendar: CalendarProvider;
  email: string;
  isMe?: boolean;
};

/**
 * A busy block on someone's calendar. Times are always UTC (ISO 8601 with Z).
 * `title` is only ever displayed on the viewer's own row.
 */
export type BusyEvent = {
  id: string;
  personId: string;
  startUtc: string;
  endUtc: string;
  title?: string;
  source: CalendarProvider | "fiutran" | "timeoff";
};

/** A meeting created and "sent" in this prototype session. */
export type Meeting = {
  id: string;
  title: string;
  startUtc: string;
  endUtc: string;
  attendeeIds: string[];
};

export type TimeOffBlock = {
  id: string;
  startUtc: string;
  endUtc: string;
  reason: string;
};
