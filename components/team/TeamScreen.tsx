"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { useApp } from "../AppProvider";
import { DateField } from "../DateField";
import { ProviderBadge } from "../Icon";
import { PRESENCE_STYLE, WeekCalendar } from "./WeekCalendar";
import { presenceAt, type Presence } from "@/lib/availability";
import { fmtDate, fmtTime, localDateIso, minToHHMM, offsetDiffLabel, tzAbbr, zonedToUtc } from "@/lib/time";
import type { CalendarProvider, Person } from "@/lib/types";
import { showYouTag } from "@/lib/people";
import { addDaysIso, mondayOf } from "@/lib/week";

const initials = (name: string) =>
  name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2);

/** People on the left; the selected person's details and week calendar on the right. */
export function TeamScreen() {
  const { people, selectedDay, setSelectedDay, today, busyIndex, now } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const person = people.find((p) => p.id === selectedId) ?? people.find((p) => p.isMe) ?? people[0];
  const monday = mondayOf(selectedDay);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Team</h1>
          <p className="text-sm text-ink-faint">Pick someone to see their week. Status and colours come from their calendar.</p>
        </div>
        <Legend />
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label="Team members" className="card h-fit p-2">
          <ul className="space-y-1">
            {people.map((p) => {
              const state = presenceAt(p, busyIndex, now);
              const active = p.id === person.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setSelectedId(p.id)}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                      active ? "bg-accent-50 ring-1 ring-inset ring-accent-200" : "hover:bg-canvas"
                    }`}
                  >
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-ink-soft ring-1 ring-line">
                      {initials(p.name)}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white ${PRESENCE_STYLE[state].dot}`}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {p.name}
                        {showYouTag(p) && <span className="font-normal text-ink-faint"> (you)</span>}
                      </span>
                      <span className={`block truncate text-xs ${PRESENCE_STYLE[state].text}`}>{PRESENCE_STYLE[state].label}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-sm">{fmtTime(now, p.timeZone)}</span>
                      <span className="block font-mono text-[10px] text-ink-faint">{tzAbbr(p.timeZone, now)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <PersonPanel
          person={person}
          monday={monday}
          selectedDay={selectedDay}
          onDay={setSelectedDay}
          today={today}
          state={presenceAt(person, busyIndex, now)}
        />
      </div>
    </>
  );
}

function PersonPanel({
  person: p,
  monday,
  selectedDay,
  onDay,
  today,
  state,
}: {
  person: Person;
  monday: string;
  selectedDay: string;
  onDay: (d: string) => void;
  today: string;
  state: Presence;
}) {
  const { now, viewerTz, connections, live: liveSync, anyLive } = useApp();
  // The calendar follows "Show times in" like everywhere else, with a switch to this person's own zone.
  const [ownZone, setOwnZone] = useState(false);
  const tz = ownZone ? p.timeZone : viewerTz;

  const whStart = zonedToUtc(selectedDay, p.workStartMin, p.timeZone);
  const whEnd = zonedToUtc(selectedDay, p.workEndMin, p.timeZone);
  const live = Boolean(p.isMe && anyLive);
  const calendars: CalendarProvider[] = live
    ? (["google", "outlook"] as const).filter((c) => liveSync[c].connected)
    : p.isMe
      ? (["outlook", "google"] as const).filter((c) => connections[c])
      : [p.calendar];
  const sunday = addDaysIso(monday, 6);

  return (
    <article className="card min-w-0 p-4 sm:p-5" aria-label={p.name}>
      {/* Who */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-50 font-semibold text-accent-700 ring-1 ring-accent-100">
            {initials(p.name)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">
              {p.name}
              {showYouTag(p) && <span className="font-normal text-ink-faint"> (you)</span>}
            </h2>
            <p className="truncate text-sm text-ink-soft">
              {p.city} · {p.timeZone.replace("_", " ")}
            </p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="font-mono text-2xl font-medium leading-tight">{fmtTime(now, p.timeZone)}</p>
          <p className="text-xs text-ink-faint">
            {tzAbbr(p.timeZone, now)} · {fmtDate(now, p.timeZone)}
            {p.timeZone !== viewerTz && ` · ${offsetDiffLabel(p.timeZone, viewerTz, now)} of ${tzAbbr(viewerTz, now)}`}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink-faint">Right now</dt>
          <dd className={`flex items-center gap-2 font-medium ${PRESENCE_STYLE[state].text}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${PRESENCE_STYLE[state].dot}`} aria-hidden="true" />
            {PRESENCE_STYLE[state].label}
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint">Working hours</dt>
          <dd className="font-mono">
            {minToHHMM(p.workStartMin)}–{minToHHMM(p.workEndMin)} {tzAbbr(p.timeZone, whStart)}
            {p.timeZone !== viewerTz && (
              <span className="block text-xs text-ink-faint">
                {fmtTime(whStart, viewerTz)}–{fmtTime(whEnd, viewerTz)} {tzAbbr(viewerTz, whStart)}
                {localDateIso(whEnd, viewerTz) !== localDateIso(whStart, viewerTz) && " (+1 day)"}
              </span>
            )}
          </dd>
        </div>
        <div>
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
            {calendars.length > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                  live ? "bg-accent-50 text-accent-700 ring-accent-200" : "bg-canvas text-ink-soft ring-line"
                }`}
              >
                {live ? "Live" : "Sample data"}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {/* Week controls */}
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            className="btn-secondary px-3"
            aria-label="Previous week"
            onClick={() => onDay(addDaysIso(selectedDay, -7))}
          >
            ‹
          </button>
          <DateField label="Week of" value={selectedDay} onChange={onDay} today={today} />
          <button type="button" className="btn-secondary px-3" aria-label="Next week" onClick={() => onDay(addDaysIso(selectedDay, 7))}>
            ›
          </button>
          <button type="button" className="btn-secondary whitespace-nowrap" onClick={() => onDay(today)}>
            This week
          </button>
        </div>
        <div>
          <label htmlFor="team-tz" className="label mb-2 block">
            Calendar in
          </label>
          <select
            id="team-tz"
            className="field w-auto"
            value={ownZone ? "theirs" : "mine"}
            onChange={(e) => setOwnZone(e.target.value === "theirs")}
            disabled={p.timeZone === viewerTz}
          >
            <option value="mine">{tzAbbr(viewerTz, now)} (your view)</option>
            {p.timeZone !== viewerTz && <option value="theirs">{tzAbbr(p.timeZone, now)} ({p.firstName}&apos;s time)</option>}
          </select>
        </div>
      </div>
      <p className="mb-2 mt-3 text-sm font-medium">
        {format(parseISO(monday), "d MMM")} – {format(parseISO(sunday), "d MMM yyyy")}
      </p>

      <WeekCalendar person={p} tz={tz} monday={monday} />
      {!p.isMe && (
        <p className="mt-2 text-xs text-ink-faint">For privacy, other people&apos;s meetings show only as &ldquo;Not reachable&rdquo;.</p>
      )}
    </article>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label="Legend">
      {(["working", "unreachable", "off"] as const).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={`inline-block h-3.5 w-3.5 rounded-sm ${PRESENCE_STYLE[s].block}`} aria-hidden="true" />
          {PRESENCE_STYLE[s].label}
        </li>
      ))}
    </ul>
  );
}
