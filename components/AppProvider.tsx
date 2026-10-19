"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleNotConnectedError,
  connectGoogle,
  createGoogleEvent,
  disconnectGoogle,
  getBusyEvents,
  getGoogleBusyEvents,
  getGoogleStatus,
  getPeople,
  type GoogleStatus,
} from "@/lib/calendarSource";
import { buildBusyIndex, type BusyIndex } from "@/lib/availability";
import { localDateIso } from "@/lib/time";
import type { BusyEvent, CalendarProvider, Meeting, Person, TimeOffBlock } from "@/lib/types";
import { addDaysIso, getDemoWeek } from "@/lib/week";

/** Outcome of writing a sent meeting to your real Google Calendar (absent when Google isn't really connected). */
export type GoogleWrite = { state: "saving" } | { state: "saved"; link?: string } | { state: "failed"; error: string };
type Confirmation = { meeting: Meeting; viewerTz: string; google?: GoogleWrite } | null;

/** Real Google Calendar connection for "you". `configured` is false when the deployment has no credentials. */
export type GoogleSync = GoogleStatus & {
  lastSynced: number | null;
  syncing: boolean;
  error: string | null;
};

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
  google: GoogleSync;
  syncGoogle: () => void;
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
  const [google, setGoogle] = useState<GoogleSync>({
    configured: false,
    connected: false,
    email: null,
    name: null,
    firstName: null,
    lastSynced: null,
    syncing: false,
    error: null,
  });
  const [googleEvents, setGoogleEvents] = useState<BusyEvent[]>([]);
  const range = useRef<{ from: Date; to: Date } | null>(null);

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
      range.current = { from, to };
      const [lists, status] = await Promise.all([
        Promise.all(people.map((p) => getBusyEvents(p.id, from, to))),
        getGoogleStatus(),
      ]);
      if (cancelled) return;
      setGoogle((g) => ({ ...g, ...status }));
      if (status.connected) setConnections((c) => ({ ...c, google: true }));
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

  const meId = basePeople.find((p) => p.isMe)?.id;

  /** Pulls your real Google events for the week. Runs on load, on tab focus, and after sending an invite. */
  const syncGoogle = useCallback(async () => {
    if (!range.current || !meId) return;
    setGoogle((g) => ({ ...g, syncing: true }));
    try {
      const list = await getGoogleBusyEvents(meId, range.current.from, range.current.to);
      setGoogleEvents(list);
      setGoogle((g) => ({ ...g, syncing: false, error: null, lastSynced: Date.now() }));
    } catch (err) {
      if (err instanceof GoogleNotConnectedError) {
        setGoogleEvents([]);
        setConnections((c) => ({ ...c, google: false }));
        setGoogle((g) => ({ ...g, connected: false, email: null, name: null, firstName: null, syncing: false, error: err.message }));
      } else {
        setGoogle((g) => ({ ...g, syncing: false, error: (err as Error).message }));
      }
    }
  }, [meId]);

  useEffect(() => {
    if (!ready || !google.connected) return;
    syncGoogle();
    // Two-way check: edit your Google Calendar in another tab, come back, and the grid updates.
    const onVisible = () => document.visibilityState === "visible" && syncGoogle();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, google.connected, syncGoogle]);

  const setConnection = useCallback(
    (p: CalendarProvider, on: boolean) => {
      // Outlook is always simulated; Google is real when this deployment has credentials.
      if (p !== "google" || !google.configured) {
        setConnections((cur) => ({ ...cur, [p]: on }));
        return;
      }
      if (on) {
        connectGoogle();
        return;
      }
      disconnectGoogle().finally(() => {
        setGoogleEvents([]);
        setConnections((cur) => ({ ...cur, google: false }));
        setGoogle((g) => ({ ...g, connected: false, email: null, name: null, firstName: null, lastSynced: null, error: null }));
      });
    },
    [google.configured],
  );

  const people = useMemo(
    () =>
      basePeople.map((p) => {
        if (!p.isMe) return p;
        // Once Google is really connected, "you" is the signed-in person.
        const real: Partial<Person> = google.connected
          ? {
              ...(google.name ? { name: google.name, firstName: google.firstName || google.name.split(" ")[0] } : {}),
              ...(google.email ? { email: google.email } : {}),
            }
          : {};
        return { ...p, ...real, ...mePatch };
      }),
    [basePeople, mePatch, google.connected, google.name, google.firstName, google.email],
  );
  const me = people.find((p) => p.isMe) ?? people[0];

  const events = useMemo(() => {
    const meId = me?.id;
    // My own calendar events only count while that calendar is connected (simulated sync).
    const fromCalendars = sourceEvents.filter(
      (e) =>
        e.personId !== meId ||
        e.source === "fiutran" ||
        e.source === "timeoff" ||
        // With your real Google Calendar connected, none of your sample events are shown.
        (connections[e.source] && !google.connected),
    );
    const fromGoogle = google.connected ? googleEvents : [];
    const fromMeetings: BusyEvent[] = meetings.flatMap((m) =>
      // Once a meeting is in your Google Calendar, your row shows Google's copy, so deleting it there frees the slot.
      m.attendeeIds.filter((pid) => !(m.googleEventId && google.connected && pid === meId)).map((pid) => ({
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
    return [...fromCalendars, ...fromGoogle, ...fromMeetings, ...fromTimeOff];
  }, [sourceEvents, meetings, timeOff, connections, me?.id, google.connected, googleEvents]);

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
    setSelectionStart(null);
    setTitle("");

    const meInvited = people.some((p) => p.isMe && invited.includes(p.id));
    if (!google.connected || !meInvited) {
      setConfirmation({ meeting, viewerTz });
      return;
    }
    // Two-way: write the meeting to your real Google Calendar.
    setConfirmation({ meeting, viewerTz, google: { state: "saving" } });
    const update = (g: GoogleWrite) =>
      setConfirmation((c) => (c && c.meeting.id === meeting.id ? { ...c, google: g } : c));
    createGoogleEvent({
      title: meeting.title,
      startUtc: meeting.startUtc,
      endUtc: meeting.endUtc,
      attendeeNames: people.filter((p) => meeting.attendeeIds.includes(p.id)).map((p) => p.name),
    })
      .then(async ({ id, htmlLink }) => {
        await syncGoogle();
        setMeetings((cur) => cur.map((m) => (m.id === meeting.id ? { ...m, googleEventId: id } : m)));
        update({ state: "saved", link: htmlLink });
      })
      .catch((err: Error) => update({ state: "failed", error: err.message }));
  }, [selectionStart, invited, title, durationMin, people, viewerTz, google.connected, syncGoogle]);

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
    setConnection,
    google,
    syncGoogle,
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
