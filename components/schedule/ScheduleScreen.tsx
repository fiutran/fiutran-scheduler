"use client";

import { useMemo } from "react";
import { useApp } from "../AppProvider";
import { DayPicker } from "../DayPicker";
import { AvailabilityGrid } from "./AvailabilityGrid";
import { ConfirmationBanner } from "./ConfirmationBanner";
import { MeetingPanel } from "./MeetingPanel";
import { Suggestions } from "./Suggestions";
import { durationLabel, tzAbbr } from "@/lib/time";

const LENGTHS = [30, 60, 90];

export function ScheduleScreen() {
  const { people, invited, toggleInvite, durationMin, setDurationMin, title, setTitle, now } = useApp();
  const invitedPeople = useMemo(() => people.filter((p) => invited.includes(p.id)), [people, invited]);

  return (
    <>
      <h1 className="sr-only">Schedule a meeting</h1>
      <ConfirmationBanner />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <section className="card grid gap-5 p-4 sm:p-5 lg:grid-cols-2" aria-label="Meeting details">
            <div role="group" aria-labelledby="who-label" className="lg:col-span-2">
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
                    {p.isMe && " (you)"}
                    <span className="font-mono text-xs opacity-80">{tzAbbr(p.timeZone, now)}</span>
                  </button>
                ))}
              </div>
            </div>

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

            <div role="group" aria-labelledby="len-label">
              <p id="len-label" className="label mb-2">
                Length
              </p>
              <div className="flex flex-wrap gap-2">
                {LENGTHS.map((m) => (
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

            <div className="lg:col-span-2">
              <DayPicker />
            </div>
          </section>

          <AvailabilityGrid invitedPeople={invitedPeople} />
        </div>

        <aside className="space-y-6" aria-label="Suggestions and meeting">
          <Suggestions invitedPeople={invitedPeople} />
          <MeetingPanel invitedPeople={invitedPeople} />
        </aside>
      </div>
    </>
  );
}
