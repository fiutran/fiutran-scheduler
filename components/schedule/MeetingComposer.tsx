"use client";

import { useEffect, useState } from "react";
import { PROVIDERS, PROVIDER_LABEL, STANDARD_LENGTHS, useApp } from "../AppProvider";
import { DateField } from "../DateField";
import { MultiSelect } from "../MultiSelect";
import { TimeField } from "../TimeField";
import { Icon } from "../Icon";
import { attendeeStatus } from "@/lib/availability";
import { showYouTag } from "@/lib/people";
import { durationLabel, fmtDate, fmtRange, fmtTime, tzAbbr, zonedToUtc } from "@/lib/time";
import type { Person } from "@/lib/types";

const MAX_MIN = 8 * 60;


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
    setSelectedDay,
    today,
    durationMin,
    setDurationMin,
    busyIndex,
    sendInvite,
    clearDraft,
    now,
    live,
    sendTarget,
    setSendTo,
  } = useApp();
  const liveConnected = PROVIDERS.filter((p) => live[p].connected);
  const meInvited = invitedPeople.some((p) => p.isMe);

  const start = selectionStart;
  const end = start === null ? null : start + durationMin * 60_000;
  const abbr = tzAbbr(viewerTz, start ?? now);

  // An invalid end time shows an error without being applied.
  const [timeError, setTimeError] = useState("");
  useEffect(() => setTimeError(""), [start, end, viewerTz]);

  function onStart(minuteOfDay: number) {
    setTimeError("");
    setSelectionStart(zonedToUtc(selectedDay, minuteOfDay, viewerTz));
  }

  function onEnd(minuteOfDay: number) {
    if (start === null) return;
    const minutes = (zonedToUtc(selectedDay, minuteOfDay, viewerTz) - start) / 60_000;
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

      {/* When and who: one row of compact controls */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
        <DateField label="Day" value={selectedDay} onChange={setSelectedDay} min={today} today={today} />
        <div role="group" aria-labelledby="time-label">
          <p id="time-label" className="label mb-2">
            Time <span className="font-normal text-ink-faint">({abbr}, 24-hour)</span>
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor="mtg-start" className="sr-only">
              Start
            </label>
            <TimeField id="mtg-start" value={start === null ? "" : fmtTime(start, viewerTz)} onCommit={onStart} />
            <span className="text-ink-faint" aria-hidden="true">
              –
            </span>
            <label htmlFor="mtg-end" className="sr-only">
              End
            </label>
            <TimeField
              id="mtg-end"
              value={end === null ? "" : fmtTime(end, viewerTz)}
              onCommit={onEnd}
              disabled={start === null}
              invalid={!!timeError}
              describedBy="time-hint"
            />
          </div>
        </div>
        <div>
          <label htmlFor="mtg-length" className="label mb-2 block">
            Length
          </label>
          <select
            id="mtg-length"
            className="field w-auto min-w-[128px]"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
          >
            {!STANDARD_LENGTHS.includes(durationMin) && (
              <option value={durationMin}>Custom · {durationLabel(durationMin)}</option>
            )}
            {STANDARD_LENGTHS.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <MultiSelect
          label="Who's invited"
          options={people.map((p) => ({
            value: p.id,
            label: `${p.firstName}${showYouTag(p) ? " (you)" : ""}`,
            hint: tzAbbr(p.timeZone, now),
          }))}
          selected={invited}
          onToggle={toggleInvite}
          summary={
            invitedPeople.length
              ? `${invitedPeople.length} · ${invitedPeople.map((p) => p.firstName).join(", ")}`
              : "No one yet"
          }
        />
        {liveConnected.length > 1 && (
          <div>
            <label htmlFor="mtg-add-to" className="label mb-2 block">
              Add to
            </label>
            <select
              id="mtg-add-to"
              className="field w-auto min-w-[168px]"
              value={sendTarget ?? ""}
              onChange={(e) => setSendTo(e.target.value as (typeof liveConnected)[number])}
            >
              {liveConnected.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {liveConnected.length === 1 && (
        <p className="-mt-1 text-xs text-ink-faint">
          {meInvited
            ? `Send invite also adds it to your ${PROVIDER_LABEL[liveConnected[0]]}.`
            : "You're not invited, so nothing is added to your calendar."}
        </p>
      )}

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
