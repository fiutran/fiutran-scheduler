"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveNotConnectedError,
  connectLive,
  createLiveEvent,
  disconnectLive,
  getBusyEvents,
  getLiveBusyEvents,
  getLiveStatus,
  getPeople,
  type LiveStatus,
} from "@/lib/calendarSource";
import { buildBusyIndex, type BusyIndex } from "@/lib/availability";
import { localDateIso } from "@/lib/time";
import type { BusyEvent, CalendarProvider, Meeting, Person, TimeOffBlock } from "@/lib/types";
import { addDaysIso, getDemoWeek } from "@/lib/week";

export const PROVIDERS: CalendarProvider[] = ["google", "outlook"];
export const PROVIDER_LABEL: Record<CalendarProvider, string> = { google: "Google Calendar", outlook: "Outlook" };

/** Outcome of writing a sent meeting to one of your real calendars (absent when none is really connected). */
export type LiveWrite = { provider: CalendarProvider } & (
  | { state: "saving" }
  | { state: "saved"; link?: string }
  | { state: "failed"; error: string }
);
type Confirmation = { meeting: Meeting; viewerTz: string; live?: LiveWrite } | null;

/** A real calendar connection for "you". `configured` is false when the deployment has no credentials for it. */
export type LiveSync = LiveStatus & {
  lastSynced: number | null;
  syncing: boolean;
  error: string | null;
};

const EMPTY_SYNC: LiveSync = {
  configured: false,
  connected: false,
  email: null,
  name: null,
  firstName: null,
  lastSynced: null,
  syncing: false,
  error: null,
};
const SEND_TO_KEY = "fiutran.sendTo";

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
  live: Record<CalendarProvider, LiveSync>;
  /** True when at least one real calendar is connected. */
  anyLive: boolean;
  syncLive: () => void;
  /** Which real calendar Send invite writes to (null when none is connected). */
  sendTarget: CalendarProvider | null;
  setSendTo: (p: CalendarProvider) => void;
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

/** Length chips offered on the schedule screen. */
export const STANDARD_LENGTHS = [30, 60, 90];

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
  const [live, setLive] = useState<Record<CalendarProvider, LiveSync>>({ google: EMPTY_SYNC, outlook: EMPTY_SYNC });
  const [liveEvents, setLiveEvents] = useState<Record<CalendarProvider, BusyEvent[]>>({ google: [], outlook: [] });
  const [sendTo, setSendToState] = useState<CalendarProvider | null>(null);
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
      const [lists, statuses] = await Promise.all([
        Promise.all(people.map((p) => getBusyEvents(p.id, from, to))),
        Promise.all(PROVIDERS.map((p) => getLiveStatus(p))),
      ]);
      if (cancelled) return;
      setLive((cur) => {
        const next = { ...cur };
        PROVIDERS.forEach((p, i) => (next[p] = { ...cur[p], ...statuses[i] }));
        return next;
      });
      // A calendar set up for real shows its true state; only unconfigured ones keep their sample toggle.
      PROVIDERS.forEach((p, i) => statuses[i].configured && setConnections((c) => ({ ...c, [p]: statuses[i].connected })));
      try {
        const saved = localStorage.getItem(SEND_TO_KEY);
        if (saved === "google" || saved === "outlook") setSendToState(saved);
      } catch {
        // Storage can be unavailable (private mode); the default target is used instead.
      }
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

  const forget = useCallback((p: CalendarProvider, error: string | null) => {
    setLiveEvents((cur) => ({ ...cur, [p]: [] }));
    setConnections((c) => ({ ...c, [p]: false }));
    setLive((cur) => ({ ...cur, [p]: { ...EMPTY_SYNC, configured: cur[p].configured, error } }));
  }, []);

  /** Pulls your real events for the week from one calendar. */
  const syncOne = useCallback(
    async (p: CalendarProvider) => {
      if (!range.current || !meId) return;
      setLive((cur) => ({ ...cur, [p]: { ...cur[p], syncing: true } }));
      try {
        const list = await getLiveBusyEvents(p, meId, range.current.from, range.current.to);
        setLiveEvents((cur) => ({ ...cur, [p]: list }));
        setLive((cur) => ({ ...cur, [p]: { ...cur[p], syncing: false, error: null, lastSynced: Date.now() } }));
      } catch (err) {
        if (err instanceof LiveNotConnectedError) forget(p, err.message);
        else setLive((cur) => ({ ...cur, [p]: { ...cur[p], syncing: false, error: (err as Error).message } }));
      }
    },
    [meId, forget],
  );

  const connectedKey = PROVIDERS.filter((p) => live[p].connected).join(",");
  /** Runs on load, on tab focus, after sending an invite, and from "Sync now". */
  const syncLive = useCallback(() => {
    PROVIDERS.forEach((p) => live[p].connected && syncOne(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedKey, syncOne]);

  useEffect(() => {
    if (!ready || !connectedKey) return;
    syncLive();
    // Two-way check: edit your calendar in another tab, come back, and the grid updates.
    const onVisible = () => document.visibilityState === "visible" && syncLive();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, connectedKey, syncLive]);

  const setConnection = useCallback(
    (p: CalendarProvider, on: boolean) => {
      // Without credentials on this deployment, a calendar stays simulated (sample data).
      if (!live[p].configured) {
        setConnections((cur) => ({ ...cur, [p]: on }));
        return;
      }
      if (on) connectLive(p);
      else disconnectLive(p).finally(() => forget(p, null));
    },
    [live, forget],
  );

  const anyLive = PROVIDERS.some((p) => live[p].connected);
  const sendTarget: CalendarProvider | null =
    sendTo && live[sendTo].connected ? sendTo : (PROVIDERS.find((p) => live[p].connected) ?? null);
  const setSendTo = useCallback((p: CalendarProvider) => {
    setSendToState(p);
    try {
      localStorage.setItem(SEND_TO_KEY, p);
    } catch {
      // Not remembered across visits when storage is unavailable.
    }
  }, []);

  // "You" takes the name and email of the first connected real calendar that provides them.
  const liveIdentity = PROVIDERS.map((p) => live[p]).find((l) => l.connected && l.name) ?? PROVIDERS.map((p) => live[p]).find((l) => l.connected);

  const people = useMemo(
    () =>
      basePeople.map((p) => {
        if (!p.isMe) return p;
        // Once a real calendar is connected, "you" is the signed-in person.
        const real: Partial<Person> = liveIdentity
          ? {
              ...(liveIdentity.name
                ? { name: liveIdentity.name, firstName: liveIdentity.firstName || liveIdentity.name.split(" ")[0] }
                : {}),
              ...(liveIdentity.email ? { email: liveIdentity.email } : {}),
            }
          : {};
        return { ...p, ...real, ...mePatch };
      }),
    [basePeople, mePatch, liveIdentity?.name, liveIdentity?.firstName, liveIdentity?.email],
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
        // With a real calendar connected, none of your sample events are shown.
        (connections[e.source] && !anyLive),
    );
    const fromLive = PROVIDERS.flatMap((p) => (live[p].connected ? liveEvents[p] : []));
    const fromMeetings: BusyEvent[] = meetings.flatMap((m) =>
      // Once a meeting is in your real calendar, your row shows that copy, so deleting it there frees the slot.
      m.attendeeIds.filter((pid) => !(m.liveEvent && live[m.liveEvent.provider].connected && pid === meId)).map((pid) => ({
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
    return [...fromCalendars, ...fromLive, ...fromMeetings, ...fromTimeOff];
  }, [sourceEvents, meetings, timeOff, connections, me?.id, anyLive, live, liveEvents]);

  const busyIndex = useMemo(() => buildBusyIndex(events), [events]);

  const setSelectedDay = useCallback((d: string) => {
    setSelectedDayState(d);
    setSelectionStart(null);
  }, []);

  const toggleInvite = useCallback((id: string) => {
    setInvited((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  // A typed (custom) length is a one-off; standard lengths are kept for the next meeting.
  const resetCustomLength = useCallback(() => setDurationMin((m) => (STANDARD_LENGTHS.includes(m) ? m : 30)), []);

  const clearDraft = useCallback(() => {
    setSelectionStart(null);
    setTitle("");
    resetCustomLength();
  }, [resetCustomLength]);

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
    resetCustomLength();

    const meInvited = people.some((p) => p.isMe && invited.includes(p.id));
    const target = sendTarget;
    if (!target || !meInvited) {
      setConfirmation({ meeting, viewerTz });
      return;
    }
    // Two-way: write the meeting to the chosen real calendar.
    setConfirmation({ meeting, viewerTz, live: { provider: target, state: "saving" } });
    const update = (w: LiveWrite) => setConfirmation((c) => (c && c.meeting.id === meeting.id ? { ...c, live: w } : c));
    createLiveEvent(target, {
      title: meeting.title,
      startUtc: meeting.startUtc,
      endUtc: meeting.endUtc,
      attendeeNames: people.filter((p) => meeting.attendeeIds.includes(p.id)).map((p) => p.name),
    })
      .then(async ({ id, link }) => {
        await syncOne(target);
        setMeetings((cur) => cur.map((m) => (m.id === meeting.id ? { ...m, liveEvent: { provider: target, id } } : m)));
        update({ provider: target, state: "saved", link });
      })
      .catch((err: Error) => update({ provider: target, state: "failed", error: err.message }));
  }, [selectionStart, invited, title, durationMin, people, viewerTz, sendTarget, syncOne, resetCustomLength]);

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
    live,
    anyLive,
    syncLive,
    sendTarget,
    setSendTo,
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
