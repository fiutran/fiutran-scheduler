"use client";

import { useMemo } from "react";
import { parseISO, format } from "date-fns";
import { useApp } from "../AppProvider";
import { Icon } from "../Icon";
import { suggestSlots, type Slot } from "@/lib/availability";
import { fmtDate, fmtRange } from "@/lib/time";
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

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="sugg-title">
      <h2 id="sugg-title" className="flex items-center gap-2 text-base font-semibold">
        <Icon name="sparkle" className="h-4 w-4 text-accent-600" />
        Suggested times
      </h2>
      <p className="mb-3 text-sm text-ink-faint">
        {durationMin} min on {dayName}, within everyone&apos;s working hours.
      </p>

      {invitedPeople.length === 0 ? (
        <p className="text-sm text-ink-soft">Invite someone to get suggestions.</p>
      ) : perfect.length > 0 ? (
        <ul className="space-y-2">
          {perfect.map((s) => (
            <li key={s.start}>
              <SlotButton slot={s} total={invitedPeople.length} active={selectionStart === s.start} onPick={setSelectionStart} tz={viewerTz} />
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div role="alert" className="mb-3 flex gap-2.5 rounded-lg border border-busy-300 bg-busy-50 p-3 text-sm text-busy-700">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">No time works for everyone on {dayName}.</span> These are the closest options.
              Consider dropping someone, a shorter meeting, or another day.
            </p>
          </div>
          {best.length ? (
            <ul className="space-y-2">
              {best.map((s) => (
                <li key={s.start}>
                  <SlotButton slot={s} total={invitedPeople.length} active={selectionStart === s.start} onPick={setSelectionStart} tz={viewerTz} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No close options either on this day.</p>
          )}
          {otherDays.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-sm text-ink-soft">Everyone is free on:</p>
              <div className="flex flex-wrap gap-2">
                {otherDays.map((d) => (
                  <button key={d} type="button" className="chip" onClick={() => setSelectedDay(d)}>
                    {format(parseISO(d), "EEE d MMM")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
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
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onPick(slot.start)}
      className={`flex min-h-11 w-full items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        active ? "border-accent-600 bg-accent-50 ring-1 ring-accent-600" : "border-line bg-white hover:border-accent-200 hover:bg-accent-50"
      }`}
    >
      <span>
        <span className="block font-mono text-sm font-medium">{fmtRange(slot.start, slot.end, tz)}</span>
        <span className="block text-xs text-ink-faint">{fmtDate(slot.start, tz)}</span>
        {!allFree && (
          <span className="mt-1 block text-xs text-ink-soft">
            Missing:{" "}
            {slot.missing
              .map((m) => `${m.person.firstName} (${m.status === "busy" ? "busy" : "off hours"})`)
              .join(", ")}
          </span>
        )}
      </span>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          allFree ? "bg-accent-600 text-white" : "bg-canvas text-ink-soft ring-1 ring-inset ring-line"
        }`}
      >
        {allFree ? "Everyone free" : `${slot.freeIds.length} of ${total} free`}
      </span>
    </button>
  );
}
