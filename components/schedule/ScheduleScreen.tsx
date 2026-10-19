"use client";

import { useMemo } from "react";
import { useApp } from "../AppProvider";
import { AvailabilityGrid } from "./AvailabilityGrid";
import { ConfirmationBanner } from "./ConfirmationBanner";
import { MeetingComposer } from "./MeetingComposer";
import { Suggestions } from "./Suggestions";

/** Grid and suggestions on the left; one "New meeting" panel on the right holds every input and Send. */
export function ScheduleScreen() {
  const { people, invited } = useApp();
  const invitedPeople = useMemo(() => people.filter((p) => invited.includes(p.id)), [people, invited]);

  return (
    <>
      <h1 className="sr-only">Schedule a meeting</h1>
      <ConfirmationBanner />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* First in reading order on small screens: you set up the meeting, then pick a time below. */}
        <div className="xl:col-start-2 xl:row-start-1">
          <div className="xl:sticky xl:top-4">
            <MeetingComposer invitedPeople={invitedPeople} />
          </div>
        </div>
        <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
          <Suggestions invitedPeople={invitedPeople} />
          <AvailabilityGrid invitedPeople={invitedPeople} />
        </div>
      </div>
    </>
  );
}
