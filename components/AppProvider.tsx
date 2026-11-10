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
  getTeamBusy,
  getTeamStatus,
  getTeamVersion,
  saveTeamTimeOff,
  deleteTeamTimeOff,
  connectICloud as connectICloudApi,
  createTeamMeeting,
  TeamSignInError,
  type LiveStatus,
  type TeamProblem,
  type TeamStatus,
  type TeamWrite,
} from "@/lib/calendarSource";
import { buildBusyIndex, type BusyIndex } from "@/lib/availability";
import { MAX_OCCURRENCES, occurrences, type RepeatFreq } from "@/lib/recurrence";
import { localDateIso } from "@/lib/time";
import type { BusyEvent, CalendarProvider, Meeting, Person, TimeOffBlock } from "@/lib/types";
import { addDaysIso, getDemoWeek, mondayOf, workWeekOf } from "@/lib/week";

export const PROVIDERS: CalendarProvider[] = ["google", "outlook", "icloud"];
export const PROVIDER_LABEL: Record<CalendarProvider, string> = {
  google: "Google Calendar",
  outlook: "Outlook",
  icloud: "iCloud Calendar",
};

/** Outcome of writing a sent meeting to one of your real calendars (absent when none is really connected). */
export type LiveWrite = { provider: CalendarProvider } & (
  | { state: "saving" }
  | { state: "saved"; link?: string }
  | { state: "failed"; error: string }
);
/** Outcome of a team meeting: which attendees' calendars it was added to. */
export type TeamSend =
  | { state: "saving" }
  | { state: "saved"; writes: TeamWrite[]; failures: { personId: string; provider: CalendarProvider }[] }
  | { state: "failed"; error: string };
type Confirmation = { meeting: Meeting; viewerTz: string; live?: LiveWrite; team?: TeamSend } | null;

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
/** Live sync: how often to check whether a teammate changed anything in the app (one cheap read). */
const CHANGE_POLL_MS = 10_000;
/** Live sync: how often to re-read everyone's calendars, for edits made directly in Google/Outlook/iCloud. */
const FULL_SYNC_MS = 60_000;

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
  /** Today's date (yyyy-MM-dd) in your own time zone. */
  today: string;

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
  /** Shared-database team sharing: whether it's on, who you are, who has connected what. */
  team: TeamStatus;
  /** True when sharing is on and this browser is signed in as a team member. */
  teamMode: boolean;
  /** Teammates' calendars that couldn't be read on the last sync. */
  teamProblems: TeamProblem[];
  /** Connects iCloud; resolves to an error message, or null on success. */
  connectICloud: (appleId: string, password: string) => Promise<string | null>;
  setSendTo: (p: CalendarProvider) => void;
  timeOff: TimeOffBlock[];
  addTimeOff: (b: Omit<TimeOffBlock, "id">) => void;
  removeTimeOff: (id: string) => void;
  /** Set when saving or removing time off for the team failed. */
  timeOffError: string | null;

  // Scheduling draft
  invited: string[];
  toggleInvite: (id: string) => void;
  durationMin: number;
  setDurationMin: (m: number) => void;
  title: string;
  setTitle: (t: string) => void;
  selectionStart: number | null;
  setSelectionStart: (ms: number | null) => void;
  /** Repeat settings for the meeting being set up ("none" = one-off). */
  repeat: { freq: RepeatFreq | "none"; count: number };
  setRepeat: (r: { freq: RepeatFreq | "none"; count: number }) => void;
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

/** Lengths offered in the Length dropdown (typed custom times can be any length). */
export const STANDARD_LENGTHS = [15, 30, 45, 60, 90, 120];

/** The UTC range fetched for a week: Monday–Friday, padded a day each side so every zone's view is covered. */
function weekRange(mondayIso: string): { from: Date; to: Date } {
  return {
    from: new Date(`${addDaysIso(mondayIso, -1)}T00:00:00Z`),
    to: new Date(`${addDaysIso(mondayIso, 6)}T00:00:00Z`),
  };
}

let idSeq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [now, setNow] = useState(0);
  const [basePeople, setBasePeople] = useState<Person[]>([]);
  const [sourceEvents, setSourceEvents] = useState<BusyEvent[]>([]);
  const [ready, setReady] = useState(false);

  const [viewerTz, setViewerTz] = useState("Asia/Kolkata");
  const [selectedDay, setSelectedDayState] = useState("");
  const [mePatch, setMePatch] = useState<Partial<Person>>({});
  const [connections, setConnections] = useState<Record<CalendarProvider, boolean>>({
    outlook: false,
    google: false,
    icloud: false,
  });
  const [timeOff, setTimeOff] = useState<TimeOffBlock[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [live, setLive] = useState<Record<CalendarProvider, LiveSync>>({
    google: EMPTY_SYNC,
    outlook: EMPTY_SYNC,
    icloud: EMPTY_SYNC,
  });
  // Real events per calendar, per week (keyed by that week's Monday), loaded as you browse.
  const [liveEvents, setLiveEvents] = useState<Record<CalendarProvider, Record<string, BusyEvent[]>>>({
    google: {},
    outlook: {},
    icloud: {},
  });
  const [sendTo, setSendToState] = useState<CalendarProvider | null>(null);
  const [team, setTeam] = useState<TeamStatus>({ shared: false, me: null, connections: {} });
  // Everyone's busy times per week (keyed by Monday), in team mode.
  const [teamEvents, setTeamEvents] = useState<Record<string, BusyEvent[]>>({});
  const [teamProblems, setTeamProblems] = useState<TeamProblem[]>([]);
  const loadedWeeks = useRef(new Set<string>());
  const [timeOffError, setTimeOffError] = useState<string | null>(null);
  // Live sync bookkeeping: last team-data version seen, a load in flight, time-off saves in flight.
  const teamVersion = useRef<number | null>(null);
  const teamLoading = useRef(false);
  const pendingTimeOff = useRef(0);

  const [invited, setInvited] = useState<string[]>([]);
  const [durationMin, setDurationMin] = useState(30);
  const [title, setTitle] = useState("");
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [repeat, setRepeatState] = useState<{ freq: RepeatFreq | "none"; count: number }>({ freq: "none", count: 10 });
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  // Load from the calendar source on the client only, so "now" never differs between server and browser.
  useEffect(() => {
    let cancelled = false;
    const start = Date.now();
    const week = getDemoWeek(new Date(start));
    setNow(start);
    const today = localDateIso(start, "Asia/Kolkata");
    setSelectedDayState(week.includes(today) ? today : week[0]);

    (async () => {
      const people = await getPeople();
      const { from, to } = weekRange(week[0]);
      loadedWeeks.current.add(week[0]);
      const [lists, statuses, teamStatus] = await Promise.all([
        Promise.all(people.map((p) => getBusyEvents(p.id, from, to))),
        Promise.all(PROVIDERS.map((p) => getLiveStatus(p))),
        getTeamStatus(),
      ]);
      if (cancelled) return;
      setTeam(teamStatus);
      setLive((cur) => {
        const next = { ...cur };
        PROVIDERS.forEach((p, i) => (next[p] = { ...cur[p], ...statuses[i] }));
        return next;
      });
      PROVIDERS.forEach((p, i) => setConnections((c) => ({ ...c, [p]: statuses[i].connected })));
      try {
        const saved = localStorage.getItem(SEND_TO_KEY);
        if (saved === "google" || saved === "outlook" || saved === "icloud") setSendToState(saved);
      } catch {
        // Storage can be unavailable (private mode); the default target is used instead.
      }
      setBasePeople(people);
      setSourceEvents(lists.flat());
      setInvited(people.map((p) => p.id));
      setReady(true);
    })();

    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, []);

  // Whoever connected a calendar in this browser is matched to their team row by email.
  const liveIdentity =
    PROVIDERS.map((p) => live[p]).find((l) => l.connected && l.name) ?? PROVIDERS.map((p) => live[p]).find((l) => l.connected);
  const matchedId = liveIdentity?.email
    ? basePeople.find((p) => p.email.toLowerCase() === liveIdentity.email!.toLowerCase())?.id
    : undefined;
  const teamMode = Boolean(team.shared && team.me);
  const meId = (teamMode ? team.me : null) ?? matchedId ?? basePeople.find((p) => p.isMe)?.id;
  const viewedMonday = selectedDay ? mondayOf(selectedDay) : "";
  const weekDays = useMemo(() => (selectedDay ? workWeekOf(selectedDay) : []), [selectedDay]);

  // Sample events for a week you browse to are fetched the first time you view it.
  useEffect(() => {
    if (!ready || !viewedMonday || loadedWeeks.current.has(viewedMonday)) return;
    loadedWeeks.current.add(viewedMonday);
    const { from, to } = weekRange(viewedMonday);
    Promise.all(basePeople.map((p) => getBusyEvents(p.id, from, to))).then((lists) =>
      setSourceEvents((cur) => {
        const seen = new Set(cur.map((e) => e.id));
        return [...cur, ...lists.flat().filter((e) => !seen.has(e.id))];
      }),
    );
  }, [ready, viewedMonday, basePeople]);

  const forget = useCallback((p: CalendarProvider, error: string | null) => {
    setLiveEvents((cur) => ({ ...cur, [p]: {} }));
    setConnections((c) => ({ ...c, [p]: false }));
    setLive((cur) => ({ ...cur, [p]: { ...EMPTY_SYNC, configured: cur[p].configured, error } }));
  }, []);

  /** Re-reads connection status for every calendar and for the team. */
  const refreshStatuses = useCallback(async () => {
    const [statuses, teamStatus] = await Promise.all([Promise.all(PROVIDERS.map((p) => getLiveStatus(p))), getTeamStatus()]);
    setLive((cur) => {
      const next = { ...cur };
      PROVIDERS.forEach((p, i) => (next[p] = { ...cur[p], ...statuses[i] }));
      return next;
    });
    PROVIDERS.forEach((p, i) => setConnections((c) => ({ ...c, [p]: statuses[i].connected })));
    setTeam(teamStatus);
  }, []);

  /**
   * Team mode: loads everyone's busy times for the week you're viewing.
   * `quiet` (background live sync) skips the "Syncing…" state and is skipped if a load is already running;
   * `fresh` drops other weeks' cached data so anything deleted elsewhere disappears everywhere.
   */
  const loadTeamWeek = useCallback(async (opts: { quiet?: boolean; fresh?: boolean } = {}) => {
    if (!viewedMonday) return;
    if (opts.quiet && teamLoading.current) return;
    teamLoading.current = true;
    const monday = viewedMonday;
    const { from, to } = weekRange(monday);
    if (!opts.quiet)
      setLive((cur) => {
        const next = { ...cur };
        PROVIDERS.forEach((p) => cur[p].connected && (next[p] = { ...cur[p], syncing: true }));
        return next;
      });
    try {
      const { events, problems, myTimeOff } = await getTeamBusy(from, to);
      setTeamEvents((cur) => (opts.fresh ? { [monday]: events } : { ...cur, [monday]: events }));
      setTeamProblems(problems);
      // Your blocks come from the server, unless you're in the middle of adding or removing one.
      if (pendingTimeOff.current === 0) setTimeOff(myTimeOff ?? []);
      setLive((cur) => {
        const next = { ...cur };
        PROVIDERS.forEach((p) => {
          const mine = problems.find((x) => x.personId === meId && x.provider === p);
          next[p] = { ...cur[p], syncing: false, lastSynced: Date.now(), error: mine ? `Your ${PROVIDER_LABEL[p]} ${mine.error}.` : null };
        });
        return next;
      });
    } catch (err) {
      if (err instanceof TeamSignInError) await refreshStatuses();
      setLive((cur) => {
        const next = { ...cur };
        PROVIDERS.forEach((p) => (next[p] = { ...cur[p], syncing: false }));
        return next;
      });
    } finally {
      teamLoading.current = false;
    }
  }, [viewedMonday, meId, refreshStatuses]);

  /** Pulls your real events for the week you're viewing from one calendar. */
  const syncOne = useCallback(
    async (p: CalendarProvider, quiet = false) => {
      if (!viewedMonday || !meId) return;
      const monday = viewedMonday;
      const { from, to } = weekRange(monday);
      if (!quiet) setLive((cur) => ({ ...cur, [p]: { ...cur[p], syncing: true } }));
      try {
        const list = await getLiveBusyEvents(p, meId, from, to);
        setLiveEvents((cur) => ({ ...cur, [p]: { ...cur[p], [monday]: list } }));
        setLive((cur) => ({ ...cur, [p]: { ...cur[p], syncing: false, error: null, lastSynced: Date.now() } }));
      } catch (err) {
        if (err instanceof LiveNotConnectedError) forget(p, err.message);
        else setLive((cur) => ({ ...cur, [p]: { ...cur[p], syncing: false, error: (err as Error).message } }));
      }
    },
    [meId, forget, viewedMonday],
  );

  const connectedKey = PROVIDERS.filter((p) => live[p].connected).join(",");
  /** Runs on load, on tab focus, and after sending an invite. */
  const syncLive = useCallback(() => {
    if (teamMode) loadTeamWeek();
    else PROVIDERS.forEach((p) => live[p].connected && syncOne(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedKey, syncOne, teamMode, loadTeamWeek]);

  useEffect(() => {
    if (!ready || (!connectedKey && !teamMode)) return;
    syncLive();
    // Two-way check: edit your calendar in another tab, come back, and the grid updates.
    const onVisible = () => document.visibilityState === "visible" && syncLive();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, connectedKey, teamMode, syncLive]);

  // Live sync, while the tab is visible (hidden tabs catch up the moment you come back):
  // - team mode: check every few seconds whether anyone changed something in the app (a meeting,
  //   time off, a calendar connection) and reload straight away if so;
  // - every minute, re-read the calendars themselves for edits made directly in Google/Outlook/iCloud.
  useEffect(() => {
    if (!ready || (!connectedKey && !teamMode)) return;
    const visible = () => document.visibilityState === "visible";
    let checking = false;
    const checkForChanges = async () => {
      if (!visible() || checking || pendingTimeOff.current > 0) return;
      checking = true;
      try {
        const v = await getTeamVersion();
        const changed = teamVersion.current !== null && v !== teamVersion.current;
        teamVersion.current = v;
        if (changed) await loadTeamWeek({ quiet: true, fresh: true });
      } catch (err) {
        if (err instanceof TeamSignInError) await refreshStatuses();
      } finally {
        checking = false;
      }
    };
    const fullSync = () => {
      if (!visible()) return;
      if (teamMode) loadTeamWeek({ quiet: true });
      else PROVIDERS.forEach((p) => live[p].connected && syncOne(p, true));
    };
    if (teamMode) checkForChanges();
    const changeTimer = teamMode ? setInterval(checkForChanges, CHANGE_POLL_MS) : undefined;
    const fullTimer = setInterval(fullSync, FULL_SYNC_MS);
    return () => {
      clearInterval(changeTimer);
      clearInterval(fullTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, connectedKey, teamMode, loadTeamWeek, syncOne, refreshStatuses]);

  /** After your own change: note the new version (so it isn't reloaded twice) and refresh now. */
  const afterTeamChange = useCallback(async () => {
    try {
      teamVersion.current = await getTeamVersion();
    } catch {
      // The next check reloads instead.
    }
    await loadTeamWeek({ quiet: true });
  }, [loadTeamWeek]);

  const addTimeOff = useCallback(
    (b: Omit<TimeOffBlock, "id">) => {
      const block = { ...b, id: newId("off") };
      setTimeOffError(null);
      setTimeOff((cur) => [...cur, block].sort((a, z) => a.startUtc.localeCompare(z.startUtc)));
      if (!teamMode) return;
      // Saved for the team right away, so teammates see it on their next check (within seconds).
      pendingTimeOff.current++;
      saveTeamTimeOff(block)
        .catch((err: Error) => {
          setTimeOff((cur) => cur.filter((x) => x.id !== block.id));
          setTimeOffError(`${err.message}. Please try again.`);
        })
        .finally(() => {
          pendingTimeOff.current--;
          afterTeamChange();
        });
    },
    [teamMode, afterTeamChange],
  );

  const removeTimeOff = useCallback(
    (id: string) => {
      const removed = timeOff.find((b) => b.id === id);
      setTimeOffError(null);
      setTimeOff((cur) => cur.filter((b) => b.id !== id));
      if (!teamMode) return;
      pendingTimeOff.current++;
      deleteTeamTimeOff(id)
        .catch((err: Error) => {
          if (removed) setTimeOff((cur) => [...cur, removed].sort((a, z) => a.startUtc.localeCompare(z.startUtc)));
          setTimeOffError(`${err.message}. Please try again.`);
        })
        .finally(() => {
          pendingTimeOff.current--;
          afterTeamChange();
        });
    },
    [teamMode, timeOff, afterTeamChange],
  );

  const setConnection = useCallback(
    (p: CalendarProvider, on: boolean) => {
      // Without credentials the server sends you back with a "not set up yet" message.
      if (on) connectLive(p);
      else
        disconnectLive(p).finally(async () => {
          forget(p, null);
          await refreshStatuses();
          setTeamEvents({});
        });
    },
    [forget, refreshStatuses],
  );

  const connectICloud = useCallback(
    async (appleId: string, password: string) => {
      try {
        await connectICloudApi(appleId, password);
        await refreshStatuses();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [refreshStatuses],
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


  const people = useMemo(
    () =>
      basePeople.map((base) => {
        const p = { ...base, isMe: base.id === meId };
        if (!p.isMe) return p;
        // An unknown account (not on the team list) takes over the default row's name and email.
        const real: Partial<Person> = liveIdentity && !matchedId
          ? {
              ...(liveIdentity.name
                ? { name: liveIdentity.name, firstName: liveIdentity.firstName || liveIdentity.name.split(" ")[0] }
                : {}),
              ...(liveIdentity.email ? { email: liveIdentity.email } : {}),
            }
          : {};
        return { ...p, ...real, ...mePatch };
      }),
    [basePeople, meId, matchedId, mePatch, liveIdentity?.name, liveIdentity?.firstName, liveIdentity?.email],
  );
  const me = people.find((p) => p.isMe) ?? people[0];

  const events = useMemo(() => {
    const meId = me?.id;
    // My own calendar events only count while that calendar is connected (simulated sync).
    // Busy times from the calendar source (teammates' synced calendars, once the shared database exists).
    const fromCalendars = sourceEvents;
    // The same event can appear in two neighbouring weeks' padded ranges; keep one copy.
    const liveSeen = new Set<string>();
    const fromLive = PROVIDERS.flatMap((p) => (live[p].connected ? Object.values(liveEvents[p]).flat() : [])).filter(
      (e) => !liveSeen.has(e.id) && liveSeen.add(e.id),
    );
    const fromMeetings: BusyEvent[] = meetings.flatMap((m) => {
      const start = Date.parse(m.startUtc);
      const end = Date.parse(m.endUtc);
      const times = m.recurrence ? occurrences(start, end, m.recurrence) : [{ start, end }];
      // Once a meeting is in your real calendar, your row shows that copy, so deleting it there frees the slot.
      const blocked = m.attendeeIds.filter((pid) => !(m.liveEvent && live[m.liveEvent.provider].connected && pid === meId));
      return times.flatMap((o) =>
        blocked.map((pid) => ({
          id: `${m.id}-${o.start}-${pid}`,
          personId: pid,
          startUtc: new Date(o.start).toISOString(),
          endUtc: new Date(o.end).toISOString(),
          title: m.title,
          source: "fiutran" as const,
        })),
      );
    });
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
    if (teamMode) {
      // Everything comes from the server: everyone's calendars, meetings made in the app and time off.
      // Your own time off is shown from your local list, so adding or removing a block is instant.
      const seen = new Set<string>();
      const fromTeam = Object.values(teamEvents)
        .flat()
        .filter((e) => !(e.source === "timeoff" && e.personId === meId))
        .filter((e) => !seen.has(e.id) && seen.add(e.id));
      return [...fromTeam, ...fromTimeOff];
    }
    return [...fromCalendars, ...fromLive, ...fromMeetings, ...fromTimeOff];
  }, [sourceEvents, meetings, timeOff, me?.id, live, liveEvents, teamMode, teamEvents]);

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
    setRepeatState((r) => ({ ...r, freq: "none" }));
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
      // A series is anchored to the organiser's own time zone.
      ...(repeat.freq !== "none" && me
        ? { recurrence: { freq: repeat.freq, count: Math.min(MAX_OCCURRENCES, Math.max(2, repeat.count)), timeZone: me.timeZone } }
        : {}),
    };
    setRepeatState((r) => ({ ...r, freq: "none" }));
    setSelectionStart(null);
    setTitle("");
    resetCustomLength();

    if (teamMode) {
      // Saved centrally and added quietly to each attendee's calendar.
      setConfirmation({ meeting, viewerTz, team: { state: "saving" } });
      const update = (t: TeamSend) => setConfirmation((c) => (c && c.meeting.id === meeting.id ? { ...c, team: t } : c));
      createTeamMeeting({ ...meeting, addTo: sendTarget ?? undefined })
        .then(async ({ writes, failures }) => {
          await afterTeamChange();
          update({ state: "saved", writes, failures });
        })
        .catch((err: Error) => update({ state: "failed", error: err.message }));
      return;
    }
    setMeetings((cur) => [...cur, meeting]);

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
      recurrence: meeting.recurrence,
    })
      .then(async ({ id, link }) => {
        await syncOne(target);
        setMeetings((cur) => cur.map((m) => (m.id === meeting.id ? { ...m, liveEvent: { provider: target, id } } : m)));
        update({ provider: target, state: "saved", link });
      })
      .catch((err: Error) => update({ provider: target, state: "failed", error: err.message }));
  }, [selectionStart, invited, title, durationMin, people, me, repeat, viewerTz, sendTarget, syncOne, resetCustomLength, teamMode, afterTeamChange]);

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
    today: me && now ? localDateIso(now, me.timeZone) : "",
    updateMe: (patch) => setMePatch((cur) => ({ ...cur, ...patch })),
    connections,
    setConnection,
    live,
    anyLive,
    syncLive,
    sendTarget,
    setSendTo,
    team,
    teamMode,
    teamProblems,
    connectICloud,
    timeOff,
    addTimeOff,
    removeTimeOff,
    timeOffError,
    invited,
    toggleInvite,
    durationMin,
    setDurationMin,
    title,
    setTitle,
    selectionStart,
    setSelectionStart,
    repeat,
    setRepeat: setRepeatState,
    sendInvite,
    clearDraft,
    confirmation,
    dismissConfirmation: () => setConfirmation(null),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
