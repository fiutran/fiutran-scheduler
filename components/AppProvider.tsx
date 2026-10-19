"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getBusyEvents, getPeople } from "@/lib/calendarSource";
import { buildBusyIndex, type BusyIndex } from "@/lib/availability";
import { localDateIso } from "@/lib/time";
import type { BusyEvent, CalendarProvider, Meeting, Person, TimeOffBlock } from "@/lib/types";
import { addDaysIso, getDemoWeek } from "@/lib/week";

type Confirmation = { meeting: Meeting; viewerTz: string } | null;

type AppState = {
  ready: boolean;
  now: number;
  weekDays: string[];
  people: Person[];
  me: Person;
  /** Every busy block the UI should treat as real: calendar events + sent meetings + time off. */
  events: BusyEvent[];
  busyIndex: BusyIndex;

  viewerTz: string;
  setViewerTz: (tz: string) => void;
  selectedDay: string;
  setSelectedDay: (d: string) => void;

  // My profile
  updateMe: (patch: Partial<Pick<Person, "timeZone" | "workStartMin" | "workEndMin" | "workDays">>) => void;
  connections: Record<CalendarProvider, boolean>;
  setConnection: (p: CalendarProvider, on: boolean) => void;
  timeOff: TimeOffBlock[];
  addTimeOff: (b: Omit<TimeOffBlock, "id">) => void;
  removeTimeOff: (id: string) => void;

  // Scheduling draft
  invited: string[];
  toggleInvite: (id: string) => void;
  durationMin: number;
  setDurationMin: (m: number) => void;
  title: string;
  setTitle: (t: string) => void;
  selectionStart: number | null;
  setSelectionStart: (ms: number | null) => void;
  sendInvite: () => void;
  clearDraft: () => void;
  confirmation: Confirmation;
  dismissConfirmation: () => void;
};

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside <AppProvider>");
  return v;
}

let idSeq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [now, setNow] = useState(0);
  const [weekDays, setWeekDays] = useState<string[]>([]);
  const [basePeople, setBasePeople] = useState<Person[]>([]);
  const [sourceEvents, setSourceEvents] = useState<BusyEvent[]>([]);
  const [ready, setReady] = useState(false);

  const [viewerTz, setViewerTz] = useState("Asia/Kolkata");
  const [selectedDay, setSelectedDayState] = useState("");
  const [mePatch, setMePatch] = useState<Partial<Person>>({});
  const [connections, setConnections] = useState<Record<CalendarProvider, boolean>>({
    outlook: true,
    google: false,
  });
  const [timeOff, setTimeOff] = useState<TimeOffBlock[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  const [invited, setInvited] = useState<string[]>([]);
  const [durationMin, setDurationMin] = useState(30);
  const [title, setTitle] = useState("");
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  // Load from the calendar source on the client only, so "now" never differs between server and browser.
  useEffect(() => {
    let cancelled = false;
    const start = Date.now();
    const week = getDemoWeek(new Date(start));
    setNow(start);
    setWeekDays(week);
    const today = localDateIso(start, "Asia/Kolkata");
    setSelectedDayState(week.includes(today) ? today : week[0]);

    (async () => {
      const people = await getPeople();
      // Pad the range by a day each side so every zone's view of the week is covered.
      const from = new Date(`${addDaysIso(week[0], -1)}T00:00:00Z`);
      const to = new Date(`${addDaysIso(week[4], 2)}T00:00:00Z`);
      const lists = await Promise.all(people.map((p) => getBusyEvents(p.id, from, to)));
      if (cancelled) return;
      setBasePeople(people);
      setSourceEvents(lists.flat());
      setInvited(people.filter((p) => p.id !== "maya").map((p) => p.id));
      setReady(true);
    })();

    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, []);

  const people = useMemo(
    () => basePeople.map((p) => (p.isMe ? { ...p, ...mePatch } : p)),
    [basePeople, mePatch],
  );
  const me = people.find((p) => p.isMe) ?? people[0];

  const events = useMemo(() => {
    const meId = me?.id;
    // My own calendar events only count while that calendar is connected (simulated sync).
    const fromCalendars = sourceEvents.filter(
      (e) => e.personId !== meId || e.source === "fiutran" || e.source === "timeoff" || connections[e.source],
    );
    const fromMeetings: BusyEvent[] = meetings.flatMap((m) =>
      m.attendeeIds.map((pid) => ({
        id: `${m.id}-${pid}`,
        personId: pid,
        startUtc: m.startUtc,
        endUtc: m.endUtc,
        title: m.title,
        source: "fiutran" as const,
      })),
    );
    const fromTimeOff: BusyEvent[] = meId
      ? timeOff.map((b) => ({
          id: b.id,
          personId: meId,
          startUtc: b.startUtc,
          endUtc: b.endUtc,
          title: `Time off: ${b.reason}`,
          source: "timeoff" as const,
        }))
      : [];
    return [...fromCalendars, ...fromMeetings, ...fromTimeOff];
  }, [sourceEvents, meetings, timeOff, connections, me?.id]);

  const busyIndex = useMemo(() => buildBusyIndex(events), [events]);

  const setSelectedDay = useCallback((d: string) => {
    setSelectedDayState(d);
    setSelectionStart(null);
  }, []);

  const toggleInvite = useCallback((id: string) => {
    setInvited((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  const clearDraft = useCallback(() => {
    setSelectionStart(null);
    setTitle("");
  }, []);

  const sendInvite = useCallback(() => {
    if (selectionStart === null || invited.length === 0) return;
    const meeting: Meeting = {
      id: newId("mtg"),
      title: title.trim() || "Untitled meeting",
      startUtc: new Date(selectionStart).toISOString(),
      endUtc: new Date(selectionStart + durationMin * 60_000).toISOString(),
      // Keep team order so attendee lists read consistently.
      attendeeIds: people.filter((p) => invited.includes(p.id)).map((p) => p.id),
    };
    setMeetings((cur) => [...cur, meeting]);
    setConfirmation({ meeting, viewerTz });
    setSelectionStart(null);
    setTitle("");
  }, [selectionStart, invited, title, durationMin, people, viewerTz]);

  const value: AppState = {
    ready,
    now,
    weekDays,
    people,
    me,
    events,
    busyIndex,
    viewerTz,
    setViewerTz,
    selectedDay,
    setSelectedDay,
    updateMe: (patch) => setMePatch((cur) => ({ ...cur, ...patch })),
    connections,
    setConnection: (p, on) => setConnections((cur) => ({ ...cur, [p]: on })),
    timeOff,
    addTimeOff: (b) => setTimeOff((cur) => [...cur, { ...b, id: newId("off") }].sort((a, z) => a.startUtc.localeCompare(z.startUtc))),
    removeTimeOff: (id) => setTimeOff((cur) => cur.filter((b) => b.id !== id)),
    invited,
    toggleInvite,
    durationMin,
    setDurationMin,
    title,
    setTitle,
    selectionStart,
    setSelectionStart,
    sendInvite,
    clearDraft,
    confirmation,
    dismissConfirmation: () => setConfirmation(null),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
