"use client";

import { useMemo } from "react";
import { parseISO, format } from "date-fns";
import { useApp } from "../AppProvider";
import { Icon } from "../Icon";
import { suggestSlots, type Slot } from "@/lib/availability";
import { durationLabel, fmtRange } from "@/lib/time";
import type { Person } from "@/lib/types";

export function Suggestions({ invitedPeople }: { invitedPeople: Person[] }) {
  const { busyIndex, selectedDay, viewerTz, durationMin, selectionStart, setSelectionStart, weekDays, setSelectedDay } =
    useApp();

  const { perfect, best } = useMemo(
    () => suggestSlots(invitedPeople, busyIndex, selectedDay, viewerTz, durationMin),
    [invitedPeople, busyIndex, selectedDay, viewerTz, durationMin],
  );

  // When today has nothing, point at days that do.
  const otherDays = useMemo(() => {
    if (perfect.length || invitedPeople.length === 0) return [];
    return weekDays.filter(
      (d) => d !== selectedDay && suggestSlots(invitedPeople, busyIndex, d, viewerTz, durationMin).perfect.length > 0,
    );
  }, [perfect.length, invitedPeople, busyIndex, weekDays, selectedDay, viewerTz, durationMin]);

  const dayName = format(parseISO(selectedDay), "EEEE");

  const slots = perfect.length ? perfect : best;
  return (
    <div className="space-y-3 p-4 sm:px-5" aria-labelledby="sugg-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="sugg-title" className="flex items-center gap-2 text-sm font-semibold">
          <Icon name="sparkle" className="h-4 w-4 text-accent-600" />
          Suggested times
        </h3>
        <p className="text-xs text-ink-faint">
          {durationLabel(durationMin)} on {dayName}, within everyone&apos;s working hours. One click picks it.
        </p>
      </div>

      {invitedPeople.length === 0 ? (
        <p className="text-sm text-ink-soft">Invite someone to get suggestions.</p>
      ) : (
        <>
          {perfect.length === 0 && (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-busy-300 bg-busy-50 px-3 py-2 text-sm text-busy-700">
              <Icon name="alert" className="h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">No time works for everyone on {dayName}.</span>{" "}
                {slots.length ? "Closest options below." : "No close options either."}
              </span>
              {otherDays.length > 0 && (
                <span className="flex flex-wrap items-center gap-2">
                  Everyone is free on
                  {otherDays.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="min-h-9 rounded-full border border-busy-300 bg-white px-3 text-sm font-medium text-ink hover:bg-busy-50"
                      onClick={() => setSelectedDay(d)}
                    >
                      {format(parseISO(d), "EEE d MMM")}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}
          {slots.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {slots.map((s) => (
                <li key={s.start}>
                  <SlotButton
                    slot={s}
                    total={invitedPeople.length}
                    active={selectionStart === s.start}
                    onPick={setSelectionStart}
                    tz={viewerTz}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SlotButton({
  slot,
  total,
  active,
  onPick,
  tz,
}: {
  slot: Slot;
  total: number;
  active: boolean;
  onPick: (ms: number) => void;
  tz: string;
}) {
  const allFree = slot.missing.length === 0;
  const missing = slot.missing
    .map((m) => `${m.person.firstName} (${m.status === "busy" ? "busy" : "off hours"})`)
    .join(", ");
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onPick(slot.start)}
      title={allFree ? "Everyone free" : `Missing: ${missing}`}
      className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition-colors ${
        active ? "border-accent-600 bg-accent-50 ring-1 ring-accent-600" : "border-line bg-white hover:border-accent-200 hover:bg-accent-50"
      }`}
    >
      <span>
        <span className="block font-mono text-sm font-medium">{fmtRange(slot.start, slot.end, tz)}</span>
        {!allFree && <span className="block max-w-[260px] truncate text-xs text-ink-soft">Missing: {missing}</span>}
      </span>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          allFree ? "bg-accent-600 text-white" : "bg-canvas text-ink-soft ring-1 ring-inset ring-line"
        }`}
      >
        {allFree ? "Everyone free" : `${slot.freeIds.length} of ${total}`}
      </span>
    </button>
  );
}
