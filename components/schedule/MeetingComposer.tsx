"use client";

import { useEffect, useState } from "react";
import { STANDARD_LENGTHS, useApp } from "../AppProvider";
import { DayPicker } from "../DayPicker";
import { Icon } from "../Icon";
import { attendeeStatus } from "@/lib/availability";
import { showYouTag } from "@/lib/people";
import { durationLabel, fmtDate, fmtRange, fmtTime, tzAbbr, zonedToUtc } from "@/lib/time";
import type { Person } from "@/lib/types";

const MAX_MIN = 8 * 60;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * The top of the meeting card: title and actions, then when, then who.
 * Each attendee's local time and status is shown on their row of the timeline below.
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

  // Typed times are kept as text so an invalid entry can show an error without being applied.
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

  const unavailable =
    start !== null && end !== null
      ? invitedPeople.filter((p) => attendeeStatus(p, busyIndex, start, end) !== "available")
      : [];
  const canSend = start !== null && invitedPeople.length > 0 && !timeError;

  let summary: React.ReactNode;
  if (timeError) summary = timeError;
  else if (invitedPeople.length === 0) summary = "Invite at least one person.";
  else if (start === null || end === null) summary = "Pick a suggested time, click the timeline, or type a start time.";
  else
    summary = (
      <>
        <span className="font-mono text-ink">
          {fmtDate(start, viewerTz)} · {fmtRange(start, end, viewerTz)}
        </span>{" "}
        · {durationLabel(durationMin)} ·{" "}
        {unavailable.length === 0 ? (
          <span className="font-medium text-accent-700">Everyone is available</span>
        ) : (
          <span className="text-busy-700">
            {invitedPeople.length - unavailable.length} of {invitedPeople.length} available. Not available:{" "}
            {unavailable.map((p) => p.firstName).join(", ")}
          </span>
        )}
      </>
    );

  return (
    <div className="p-4 sm:p-5">
      <h2 id="mtg-title" className="sr-only">
        New meeting
      </h2>
      <div className="space-y-4">

      {/* Title + actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="mtg-title-input" className="label mb-1.5 block">
            Meeting title
          </label>
          <input
            id="mtg-title-input"
            className="field text-base"
            placeholder="e.g. Q4 planning sync"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1 sm:flex-none sm:px-6" onClick={sendInvite} disabled={!canSend}>
            <Icon name="send" className="h-4 w-4" />
            Send invite
          </button>
          <button type="button" className="btn-secondary" onClick={clearDraft}>
            Clear
          </button>
        </div>
      </div>

      {/* When */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <DayPicker />
        <div role="group" aria-labelledby="time-label">
          <p id="time-label" className="label mb-2">
            Time <span className="font-normal text-ink-faint">({abbr})</span>
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor="mtg-start" className="sr-only">
              Start
            </label>
            <input
              id="mtg-start"
              type="time"
              step={300}
              className="field w-[132px] font-mono"
              value={startText}
              onChange={(e) => onStart(e.target.value)}
            />
            <span className="text-ink-faint" aria-hidden="true">
              –
            </span>
            <label htmlFor="mtg-end" className="sr-only">
              End
            </label>
            <input
              id="mtg-end"
              type="time"
              step={300}
              className="field w-[132px] font-mono"
              value={endText}
              disabled={start === null}
              onChange={(e) => onEnd(e.target.value)}
              aria-invalid={!!timeError}
              aria-describedby="time-hint"
            />
          </div>
        </div>
        <div role="group" aria-label="Length">
          <p className="label mb-2" aria-hidden="true">
            Length
          </p>
          <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      {/* Who */}
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

      <p
        id="time-hint"
        role={timeError ? "alert" : "status"}
        className={`rounded-lg px-3 py-2 text-sm ${
          timeError ? "bg-busy-50 font-medium text-busy-700" : "bg-canvas text-ink-soft"
        }`}
      >
        {summary}
      </p>
      </div>
    </div>
  );
}
