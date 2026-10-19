"use client";

import { useMemo } from "react";
import { useApp } from "../AppProvider";
import { AvailabilityGrid } from "./AvailabilityGrid";
import { ConfirmationBanner } from "./ConfirmationBanner";
import { MeetingComposer } from "./MeetingComposer";
import { Suggestions } from "./Suggestions";

/**
 * One card, top to bottom like a calendar's event form: what and when, who, suggested times,
 * then the free/busy timeline where each row also shows how the meeting lands for that person.
 */
export function ScheduleScreen() {
  const { people, invited } = useApp();
  const invitedPeople = useMemo(() => people.filter((p) => invited.includes(p.id)), [people, invited]);

  return (
    <>
      <h1 className="sr-only">Schedule a meeting</h1>
      <ConfirmationBanner />
      <section className="card divide-y divide-line" aria-labelledby="mtg-title">
        <MeetingComposer invitedPeople={invitedPeople} />
        <Suggestions invitedPeople={invitedPeople} />
        <AvailabilityGrid invitedPeople={invitedPeople} />
      </section>
    </>
  );
}
