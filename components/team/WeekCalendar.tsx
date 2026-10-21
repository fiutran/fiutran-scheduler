"use client";

import { useEffect, useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";
import { useApp } from "../AppProvider";
import { presenceSegments, type Presence } from "@/lib/availability";
import { dayBounds, fmtTime, tzAbbr } from "@/lib/time";
import type { Person } from "@/lib/types";
import { addDaysIso } from "@/lib/week";

const HOUR_PX = 40;

export const PRESENCE_STYLE: Record<Presence, { label: string; block: string; dot: string; text: string }> = {
  working: {
    label: "Working",
    block: "bg-green-50 border-l-[3px] border-green-500",
    dot: "bg-green-600",
    text: "text-green-800",
  },
  unreachable: {
    label: "Not reachable",
    block: "bg-red-100 border-l-[3px] border-red-600",
    dot: "bg-red-600",
    text: "text-red-800",
  },
  off: { label: "Not working", block: "hatch", dot: "bg-ink-faint", text: "text-ink-soft" },
};

/**
 * Monday–Sunday week of one person's calendar in `tz`, coloured by presence.
 * Other people's busy blocks never reveal titles; your own do.
 */
export function WeekCalendar({ person, tz, monday }: { person: Person; tz: string; monday: string }) {
  const { busyIndex, now, today } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i)), [monday]);

  const columns = useMemo(
    () =>
      days.map((d) => {
        const { start, end } = dayBounds(d, tz);
        return { date: d, start, end, segments: presenceSegments(person, busyIndex, d, tz) };
      }),
    [days, tz, person, busyIndex],
  );

  // Start the view an hour before the earliest working time of the week.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstWork = Math.min(
      ...columns.map((c) => {
        const s = c.segments.find((x) => x.state !== "off");
        return s ? (s.start - c.start) / 3_600_000 : 24;
      }),
    );
    // Back off a few pixels so the first visible hour label isn't cut in half.
    el.scrollTop = Math.max(0, (Math.floor(firstWork === 24 ? 8 : firstWork) - 1) * HOUR_PX - 10);
  }, [columns]);

  const abbr = tzAbbr(tz, columns[0]?.start ?? now);

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      {/* Day headers */}
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-line bg-canvas">
        <div className="py-2 text-center font-mono text-[10px] text-ink-faint">{abbr}</div>
        {days.map((d) => (
          <div
            key={d}
            className={`border-l border-line py-2 text-center text-xs ${d === today ? "font-semibold text-accent-700" : "text-ink-soft"}`}
          >
            <span className="block">{format(parseISO(d), "EEE")}</span>
            <span className={`mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-mono ${d === today ? "bg-accent-600 text-white" : ""}`}>
              {format(parseISO(d), "d")}
            </span>
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="max-h-[560px] overflow-y-auto">
        <div className="relative grid grid-cols-[52px_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
          {/* Hour gutter */}
          <div className="relative" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-ink-faint" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>

          {columns.map((col) => {
            const span = col.end - col.start; // 23–25 h on daylight-saving days
            const pct = (t: number) => ((t - col.start) / span) * 100;
            const isToday = now >= col.start && now < col.end;
            return (
              <div
                key={col.date}
                role="list"
                aria-label={`${person.firstName}, ${format(parseISO(col.date), "EEEE d MMMM")}`}
                className="relative border-l border-line"
              >
                {/* Hour lines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-line/60" style={{ top: h * HOUR_PX }} aria-hidden="true" />
                ))}
                {col.segments.map((s) => {
                  const st = PRESENCE_STYLE[s.state];
                  const range = `${fmtTime(s.start, tz)}–${fmtTime(s.end, tz)}`;
                  // Only your own calendar shows what you're busy with.
                  const what = s.state === "unreachable" && person.isMe && s.title ? s.title : st.label;
                  const heightPx = ((s.end - s.start) / span) * 24 * HOUR_PX;
                  return (
                    <div
                      key={s.start}
                      role="listitem"
                      aria-label={`${range} ${abbr}: ${what}`}
                      title={`${range} ${abbr} · ${what}`}
                      className={`absolute inset-x-0.5 overflow-hidden rounded-[4px] px-1.5 ${st.block}`}
                      style={{ top: `${pct(s.start)}%`, height: `${((s.end - s.start) / span) * 100}%` }}
                    >
                      {s.state !== "off" && heightPx >= 22 && (
                        <p className={`hidden truncate pt-0.5 text-[11px] font-medium leading-tight sm:block ${st.text}`}>
                          {what}
                          {heightPx >= 36 && <span className="block font-mono font-normal opacity-80">{range}</span>}
                        </p>
                      )}
                    </div>
                  );
                })}
                {isToday && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-red-600" style={{ top: `${pct(now)}%` }} aria-hidden="true">
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-red-600" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
