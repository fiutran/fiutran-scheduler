"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PROVIDER_LABEL, useApp } from "../AppProvider";
import { AvailabilityGrid } from "./AvailabilityGrid";
import { ConfirmationBanner } from "./ConfirmationBanner";
import { MeetingComposer } from "./MeetingComposer";
import { Suggestions } from "./Suggestions";

/**
 * One card, top to bottom like a calendar's event form: what and when, who, suggested times,
 * then the free/busy timeline where each row also shows how the meeting lands for that person.
 */
export function ScheduleScreen() {
  const { people, invited, team, teamProblems } = useApp();
  const name = (pid: string) => people.find((p) => p.id === pid)?.firstName ?? pid;
  const invitedPeople = useMemo(() => people.filter((p) => invited.includes(p.id)), [people, invited]);

  return (
    <>
      <h1 className="sr-only">Schedule a meeting</h1>
      <ConfirmationBanner />
      {team.shared && !team.me && (
        <p role="status" className="mb-4 rounded-xl border border-accent-200 bg-accent-50 p-4 text-sm text-accent-800">
          Team sharing is on. <Link href="/profile" className="font-semibold underline">Connect your calendar on My profile</Link> to sign
          in and see everyone&apos;s real availability.
        </p>
      )}
      {teamProblems.length > 0 && (
        <p role="status" className="mb-4 rounded-xl border border-busy-300 bg-busy-50 p-4 text-sm text-busy-700">
          {teamProblems.map((x) => `${name(x.personId)}'s ${PROVIDER_LABEL[x.provider]} ${x.error}`).join("; ")}. Their busy
          times from that calendar are missing until it&apos;s fixed on their My profile.
        </p>
      )}
      <section className="card divide-y divide-line" aria-labelledby="mtg-title">
        <MeetingComposer invitedPeople={invitedPeople} />
        <Suggestions invitedPeople={invitedPeople} />
        <AvailabilityGrid invitedPeople={invitedPeople} />
      </section>
    </>
  );
}
