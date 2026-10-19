"use client";

import { useEffect, useState } from "react";
import { STANDARD_LENGTHS, useApp } from "../AppProvider";
import { DayPicker } from "../DayPicker";
import { Icon } from "../Icon";
import { StatusChip } from "./StatusChip";
import { attendeeStatus } from "@/lib/availability";
import { showYouTag } from "@/lib/people";
import { durationLabel, fmtDate, fmtDateLong, fmtTime, localDateIso, tzAbbr, zonedToUtc } from "@/lib/time";
import type { Person } from "@/lib/types";

const MAX_MIN = 8 * 60;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Everything needed to set up and send a meeting, top to bottom in one panel:
 * title → who → day → time → how it lands for each attendee → Send.
 */
export function MeetingComposer({ invitedPeople }: { invitedPeople: Person[] }) {
  const {
    people,
    invited,
    toggleInvite,
    title,
    setTitle,
    selectedDay,
    viewerTz,
    selectionStart,
    setSelectionStart,
    durationMin,
    setDurationMin,
    busyIndex,
    sendInvite,
    clearDraft,
    now,
  } = useApp();

  const start = selectionStart;
  const end = start === null ? null : start + durationMin * 60_000;
  const abbr = tzAbbr(viewerTz, start ?? now);

  // Typed times are kept as text so a half-typed or invalid entry can show an error without being applied.
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [timeError, setTimeError] = useState("");
  useEffect(() => {
    setStartText(start === null ? "" : fmtTime(start, viewerTz));
    setEndText(end === null ? "" : fmtTime(end, viewerTz));
    setTimeError("");
  }, [start, end, viewerTz]);

  function onStart(value: string) {
    setStartText(value);
    if (!value) return;
    setTimeError("");
    setSelectionStart(zonedToUtc(selectedDay, toMinutes(value), viewerTz));
  }

  function onEnd(value: string) {
    setEndText(value);
    if (!value || start === null) return;
    const minutes = (zonedToUtc(selectedDay, toMinutes(value), viewerTz) - start) / 60_000;
    if (minutes <= 0) return setTimeError("End time must be after the start time.");
    if (minutes > MAX_MIN) return setTimeError("Meetings can be at most 8 hours long.");
    setTimeError("");
    setDurationMin(minutes);
  }

  const rows =
    start !== null && end !== null
      ? invitedPeople.map((p) => ({ p, status: attendeeStatus(p, busyIndex, start, end) }))
      : [];
  const conflicts = rows.filter((r) => r.status !== "available").length;
  const viewerDate = start === null ? "" : localDateIso(start, viewerTz);
  const canSend = start !== null && invitedPeople.length > 0 && !timeError;

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="mtg-title">
      <h2 id="mtg-title" className="text-base font-semibold">
        New meeting
      </h2>

      <div className="mt-4 space-y-5">
        <div>
          <label htmlFor="mtg-title-input" className="label mb-2 block">
            Meeting title
          </label>
          <input
            id="mtg-title-input"
            className="field"
            placeholder="e.g. Q4 planning sync"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div role="group" aria-labelledby="who-label">
          <p id="who-label" className="label mb-2">
            Who&apos;s invited
          </p>
          <div className="flex flex-wrap gap-2">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                className="chip"
                aria-pressed={invited.includes(p.id)}
                onClick={() => toggleInvite(p.id)}
              >
                {p.firstName}
                {showYouTag(p) && " (you)"}
                <span className="font-mono text-xs opacity-80">{tzAbbr(p.timeZone, now)}</span>
              </button>
            ))}
          </div>
        </div>

        <DayPicker />

        <div role="group" aria-labelledby="time-label">
          <p id="time-label" className="label mb-2">
            Time <span className="font-normal text-ink-faint">({abbr})</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="mtg-start" className="mb-1 block text-xs text-ink-faint">
                Start
              </label>
              <input
                id="mtg-start"
                type="time"
                step={300}
                className="field font-mono"
                value={startText}
                onChange={(e) => onStart(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="mtg-end" className="mb-1 block text-xs text-ink-faint">
                End
              </label>
              <input
                id="mtg-end"
                type="time"
                step={300}
                className="field font-mono"
                value={endText}
                disabled={start === null}
                onChange={(e) => onEnd(e.target.value)}
                aria-invalid={!!timeError}
                aria-describedby="time-hint"
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Length">
            {STANDARD_LENGTHS.map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                aria-pressed={durationMin === m}
                onClick={() => setDurationMin(m)}
              >
                {durationLabel(m)}
              </button>
            ))}
          </div>
          <p
            id="time-hint"
            role={timeError ? "alert" : undefined}
            className={`mt-2 text-xs ${timeError ? "font-medium text-busy-700" : "text-ink-faint"}`}
          >
            {timeError ||
              (start === null
                ? "Type a start time, pick a suggestion, or click the grid."
                : `${fmtDateLong(start, viewerTz)} · ${durationLabel(durationMin)}`)}
          </p>
        </div>

        {rows.length > 0 && start !== null && end !== null && (
          <div>
            <h3 className="text-sm font-semibold">How it lands ({rows.length})</h3>
            <ul className="mt-1 divide-y divide-line">
              {rows.map(({ p, status }) => {
                const theirDate = localDateIso(start, p.timeZone);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {p.name}
                        {showYouTag(p) && <span className="font-normal text-ink-faint"> (you)</span>}
                      </p>
                      <p className="font-mono text-xs text-ink-soft">
                        {fmtTime(start, p.timeZone)}–{fmtTime(end, p.timeZone)} {tzAbbr(p.timeZone, start)}
                        {theirDate !== viewerDate && (
                          <span className="ml-1.5 rounded bg-canvas px-1.5 py-0.5 font-sans text-ink ring-1 ring-inset ring-line">
                            {fmtDate(start, p.timeZone)}
                          </span>
                        )}
                      </p>
                    </div>
                    <StatusChip status={status} />
                  </li>
                );
              })}
            </ul>
            {conflicts > 0 && (
              <p className="mt-1 text-xs text-busy-700">
                {conflicts} attendee{conflicts > 1 ? "s" : ""} can&apos;t make this time. You can still send the invite.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" onClick={sendInvite} disabled={!canSend}>
            <Icon name="send" className="h-4 w-4" />
            Send invite
          </button>
          <button type="button" className="btn-secondary" onClick={clearDraft}>
            Clear
          </button>
        </div>
        {invitedPeople.length === 0 && <p className="-mt-3 text-xs text-ink-faint">Invite at least one person.</p>}
      </div>
    </section>
  );
}
