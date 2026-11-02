"use client";

import { PROVIDER_LABEL, useApp } from "../AppProvider";
import { Icon } from "../Icon";
import { recurrenceSummary } from "@/lib/recurrence";
import { fmtDate, fmtRange, localDateIso } from "@/lib/time";

export function ConfirmationBanner() {
  const { confirmation, dismissConfirmation, people } = useApp();
  if (!confirmation) return null;
  const { meeting, viewerTz, live, team } = confirmation;
  const who = (pid: string) => {
    const p = people.find((x) => x.id === pid);
    return p?.isMe ? "your" : `${p?.firstName ?? "their"}'s`;
  };
  const start = Date.parse(meeting.startUtc);
  const end = Date.parse(meeting.endUtc);
  const names = people.filter((p) => meeting.attendeeIds.includes(p.id)).map((p) => (p.isMe ? "you" : p.firstName));

  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-accent-200 bg-accent-50 p-4 text-sm text-accent-800">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white">
        <Icon name="check" className="h-4 w-4" />
      </span>
      <div className="flex-1">
        <p className="font-semibold">
          Invite sent: {meeting.title}
          {meeting.recurrence && (
            <span className="font-normal">
              {" "}
              · repeats {recurrenceSummary(meeting.recurrence, localDateIso(start, meeting.recurrence.timeZone))}
            </span>
          )}
        </p>
        <p>
          {fmtDate(start, viewerTz)}, <span className="font-mono">{fmtRange(start, end, viewerTz)}</span> with{" "}
          {names.join(", ")}. It now shows as busy for everyone invited.
        </p>
        {team?.state === "saving" && <p className="mt-1">Adding it to everyone&apos;s calendars…</p>}
        {team?.state === "saved" && team.writes.length > 0 && (
          <p className="mt-1">
            Added to {team.writes.map((w) => `${who(w.personId)} ${PROVIDER_LABEL[w.provider]}`).join(" and ")}. No emails were sent.
          </p>
        )}
        {team?.state === "saved" && team.failures.length > 0 && (
          <p className="mt-1 font-medium text-busy-700">
            Couldn&apos;t add it to {team.failures.map((f) => `${who(f.personId)} ${PROVIDER_LABEL[f.provider]}`).join(" or ")}. It still
            shows as busy in the app.
          </p>
        )}
        {team?.state === "failed" && <p className="mt-1 font-medium text-busy-700">Couldn&apos;t save the meeting: {team.error}</p>}
        {live?.state === "saving" && <p className="mt-1">Adding it to your {PROVIDER_LABEL[live.provider]}…</p>}
        {live?.state === "saved" && (
          <p className="mt-1">
            Added to your {PROVIDER_LABEL[live.provider]}.{" "}
            {live.link && (
              <a href={live.link} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                Open in {live.provider === "google" ? "Google Calendar" : "Outlook"}
              </a>
            )}
          </p>
        )}
        {live?.state === "failed" && (
          <p className="mt-1 font-medium text-busy-700">
            Couldn&apos;t add it to your {PROVIDER_LABEL[live.provider]}: {live.error}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={dismissConfirmation}
        className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent-100"
        aria-label="Dismiss confirmation"
      >
        <Icon name="x" className="h-4 w-4" />
      </button>
    </div>
  );
}
