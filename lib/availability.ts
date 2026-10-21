import type { BusyEvent, Person } from "./types";
import { SLOT_MS, dayCells, localParts } from "./time";

export type CellState = "free" | "busy" | "off";
export type AttendeeStatus = "available" | "busy" | "off";

/** Busy intervals in UTC ms, grouped by person, for fast overlap checks. */
export type BusyIndex = Map<string, { start: number; end: number; event: BusyEvent }[]>;

export function buildBusyIndex(events: BusyEvent[]): BusyIndex {
  const idx: BusyIndex = new Map();
  for (const e of events) {
    const list = idx.get(e.personId) ?? [];
    list.push({ start: Date.parse(e.startUtc), end: Date.parse(e.endUtc), event: e });
    idx.set(e.personId, list);
  }
  return idx;
}

export function busyAt(index: BusyIndex, personId: string, start: number, end: number): BusyEvent | undefined {
  return index.get(personId)?.find((b) => b.start < end && b.end > start)?.event;
}

/** True when all of [start, end) is inside the person's local working hours. Works for any start and length. */
export function isWorking(person: Person, start: number, end: number): boolean {
  for (let t = start; t < end; t += SLOT_MS) {
    const { isoDay, minute } = localParts(t, person.timeZone);
    const len = Math.min(SLOT_MS, end - t) / 60_000;
    if (!person.workDays.includes(isoDay)) return false;
    if (minute < person.workStartMin || minute + len > person.workEndMin) return false;
  }
  return true;
}

export function cellState(person: Person, index: BusyIndex, start: number): CellState {
  if (busyAt(index, person.id, start, start + SLOT_MS)) return "busy";
  return isWorking(person, start, start + SLOT_MS) ? "free" : "off";
}

/** Status for a meeting range. Busy wins over off hours, as it's the harder conflict. */
export function attendeeStatus(person: Person, index: BusyIndex, start: number, end: number): AttendeeStatus {
  if (busyAt(index, person.id, start, end)) return "busy";
  return isWorking(person, start, end) ? "available" : "off";
}

export type Slot = {
  start: number;
  end: number;
  freeIds: string[];
  missing: { person: Person; status: AttendeeStatus }[];
};

/**
 * Suggested times on a day (in the viewer's zone).
 * `perfect`: first 4 non-overlapping slots where everyone is available.
 * `best`: when there are none, up to 4 non-overlapping slots with the most people available.
 */
export function suggestSlots(
  people: Person[],
  index: BusyIndex,
  dateIso: string,
  viewerTz: string,
  durationMin: number,
): { perfect: Slot[]; best: Slot[] } {
  if (people.length === 0) return { perfect: [], best: [] };
  const dur = durationMin * 60_000;
  const candidates: Slot[] = dayCells(dateIso, viewerTz).map((start) => {
    const end = start + dur;
    const freeIds: string[] = [];
    const missing: Slot["missing"] = [];
    for (const p of people) {
      const status = attendeeStatus(p, index, start, end);
      if (status === "available") freeIds.push(p.id);
      else missing.push({ person: p, status });
    }
    return { start, end, freeIds, missing };
  });

  const pick = (sorted: Slot[], byTime: boolean) => {
    const chosen: Slot[] = [];
    for (const s of sorted) {
      if (chosen.length === 4) break;
      if (chosen.every((c) => s.end <= c.start || s.start >= c.end)) chosen.push(s);
    }
    return byTime ? chosen.sort((a, b) => a.start - b.start) : chosen;
  };

  const perfect = pick(candidates.filter((c) => c.missing.length === 0), true);
  if (perfect.length) return { perfect, best: [] };

  // Only offer near-misses: at most two people missing (or at least one free in tiny groups).
  const minFree = Math.max(1, people.length - 2);
  const anyFree = candidates.filter((c) => c.freeIds.length >= minFree);
  const best = pick([...anyFree].sort((a, b) => b.freeIds.length - a.freeIds.length || a.start - b.start), false);
  return { perfect: [], best };
}

/** Team-screen categories: working (free, in hours), not reachable (busy), not working (outside hours / time off days). */
export type Presence = "working" | "unreachable" | "off";
const PRESENCE: Record<CellState, Presence> = { free: "working", busy: "unreachable", off: "off" };

/** Someone's state at a moment, e.g. right now. */
export function presenceAt(person: Person, index: BusyIndex, at: number): Presence {
  if (busyAt(index, person.id, at, at + 60_000)) return "unreachable";
  return isWorking(person, at, at + 60_000) ? "working" : "off";
}

export type PresenceSegment = { start: number; end: number; state: Presence; title?: string };

/**
 * A day (in `tz`) split into consecutive same-state segments, at 30-minute resolution.
 * `title` is the first busy event's title in an "unreachable" segment; callers decide whether to show it.
 */
export function presenceSegments(person: Person, index: BusyIndex, dateIso: string, tz: string): PresenceSegment[] {
  const out: PresenceSegment[] = [];
  for (const c of dayCells(dateIso, tz)) {
    const state = PRESENCE[cellState(person, index, c)];
    const title = state === "unreachable" ? busyAt(index, person.id, c, c + SLOT_MS)?.title : undefined;
    const last = out[out.length - 1];
    if (last && last.state === state && last.end === c && last.title === title) last.end = c + SLOT_MS;
    else out.push({ start: c, end: c + SLOT_MS, state, title });
  }
  return out;
}
