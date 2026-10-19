"use client";

import { useMemo } from "react";
import { useApp } from "../AppProvider";
import { DayPicker } from "../DayPicker";
import { Icon, ProviderBadge } from "../Icon";
import { busyAt, cellState, isWorking, type CellState } from "@/lib/availability";
import {
  SLOT_MS,
  dayCells,
  fmtDate,
  fmtTime,
  localDateIso,
  minToHHMM,
  offsetDiffLabel,
  tzAbbr,
  zonedToUtc,
} from "@/lib/time";
import type { CalendarProvider, Person } from "@/lib/types";

export function TeamScreen() {
  const { people } = useApp();
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Team</h1>
          <p className="text-sm text-ink-faint">Live local times and today&apos;s status, from each person&apos;s calendar.</p>
        </div>
        <DayPicker id="team-day" />
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {people.map((p) => (
          <li key={p.id}>
            <TeamCard person={p} />
          </li>
        ))}
      </ul>
    </>
  );
}

const STATUS = {
  free: { label: "Free now", dot: "bg-accent-600" },
  meeting: { label: "In a meeting", dot: "bg-busy-400" },
  off: { label: "Outside working hours", dot: "bg-ink-faint" },
};

function TeamCard({ person: p }: { person: Person }) {
  const { now, busyIndex, viewerTz, selectedDay, connections } = useApp();

  const status = !isWorking(p, now, now + 60_000)
    ? STATUS.off
    : busyAt(busyIndex, p.id, now, now + 60_000)
      ? STATUS.meeting
      : STATUS.free;

  // Working hours on the selected day, converted into the viewer's zone.
  const whStart = zonedToUtc(selectedDay, p.workStartMin, p.timeZone);
  const whEnd = zonedToUtc(selectedDay, p.workEndMin, p.timeZone);
  const startDay = localDateIso(whStart, viewerTz);
  const endDay = localDateIso(whEnd, viewerTz);

  const calendars: CalendarProvider[] = p.isMe
    ? (["outlook", "google"] as const).filter((c) => connections[c])
    : [p.calendar];

  const initials = p.name
    .split(" ")
    .map((s) => s[0])
    .join("");

  return (
    <article className="card flex h-full flex-col p-5" aria-label={p.name}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-50 text-sm font-semibold text-accent-700 ring-1 ring-accent-100">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">
            {p.name}
            {p.isMe && <span className="font-normal text-ink-faint"> (you)</span>}
          </h2>
          <p className="truncate text-sm text-ink-soft">
            {p.city} · {p.timeZone.replace("_", " ")}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-xl font-medium leading-tight">{fmtTime(now, p.timeZone)}</p>
          <p className="text-xs text-ink-faint">
            {tzAbbr(p.timeZone, now)} · {fmtDate(now, p.timeZone)}
          </p>
        </div>
      </div>

      <p className="mt-4 flex items-center gap-2 text-sm font-medium">
        <span className={`h-2.5 w-2.5 rounded-full ${status.dot}`} aria-hidden="true" />
        {status.label}
        {p.timeZone !== viewerTz && (
          <span className="font-normal text-ink-faint">· {offsetDiffLabel(p.timeZone, viewerTz, now)} of {tzAbbr(viewerTz, now)}</span>
        )}
      </p>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-faint">Their hours</dt>
        <dd className="font-mono">
          {minToHHMM(p.workStartMin)}–{minToHHMM(p.workEndMin)} {tzAbbr(p.timeZone, whStart)}
        </dd>
        <dt className="text-ink-faint">In {tzAbbr(viewerTz, whStart)}</dt>
        <dd className="font-mono">
          {fmtTime(whStart, viewerTz)}–{fmtTime(whEnd, viewerTz)}
          {endDay !== startDay && <span className="ml-1 font-sans text-xs text-ink-faint">(+1 day)</span>}
          {startDay !== selectedDay && (
            <span className="ml-1 font-sans text-xs text-ink-faint">({fmtDate(whStart, viewerTz)})</span>
          )}
        </dd>
        <dt className="text-ink-faint">Calendar</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          {calendars.length === 0 ? (
            <span className="text-ink-soft">None connected</span>
          ) : (
            calendars.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5">
                <ProviderBadge provider={c} />
                {c === "outlook" ? "Outlook" : "Google"}
              </span>
            ))
          )}
        </dd>
      </dl>

      <DayBar person={p} />
    </article>
  );
}

const BAR: Record<CellState, string> = { free: "bg-white", busy: "bg-busy-400", off: "hatch" };

function DayBar({ person }: { person: Person }) {
  const { busyIndex, selectedDay, viewerTz, now } = useApp();
  const cells = useMemo(() => dayCells(selectedDay, viewerTz), [selectedDay, viewerTz]);
  const states = cells.map((c) => cellState(person, busyIndex, c));
  const span = cells.length * SLOT_MS;
  const nowPct = now >= cells[0] && now < cells[0] + span ? ((now - cells[0]) / span) * 100 : null;
  const free = states.filter((s) => s === "free").length / 2;
  const busy = states.filter((s) => s === "busy").length / 2;

  return (
    <div className="mt-auto pt-5">
      <p className="mb-1.5 flex justify-between text-xs text-ink-faint">
        <span>{fmtDate(cells[0], viewerTz)} in {tzAbbr(viewerTz, cells[0])}</span>
        <span>
          {free}h free · {busy}h busy
        </span>
      </p>
      <div
        className="relative flex h-3 overflow-hidden rounded-full ring-1 ring-inset ring-line"
        role="img"
        aria-label={`${person.firstName} on ${fmtDate(cells[0], viewerTz)}: ${free} hours free, ${busy} hours busy`}
      >
        {states.map((s, i) => (
          <span key={i} className={`h-full flex-1 ${BAR[s]}`} />
        ))}
        {nowPct !== null && <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${nowPct}%` }} />}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}
