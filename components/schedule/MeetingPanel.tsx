"use client";

import { useApp } from "../AppProvider";
import { Icon } from "../Icon";
import { StatusChip } from "./StatusChip";
import { attendeeStatus } from "@/lib/availability";
import { fmtDate, fmtDateLong, fmtRange, fmtTime, localDateIso, tzAbbr } from "@/lib/time";
import type { Person } from "@/lib/types";

export function MeetingPanel({ invitedPeople }: { invitedPeople: Person[] }) {
  const { selectionStart, durationMin, viewerTz, busyIndex, title, sendInvite, clearDraft } = useApp();

  if (selectionStart === null) {
    return (
      <section className="card p-4 sm:p-5" aria-labelledby="mtg-title">
        <h2 id="mtg-title" className="text-base font-semibold">
          Meeting
        </h2>
        <p className="mt-1 text-sm text-ink-faint">
          Pick a suggested time or click a cell in the grid to see how it lands for each attendee.
        </p>
      </section>
    );
  }

  const start = selectionStart;
  const end = start + durationMin * 60_000;
  const viewerDate = localDateIso(start, viewerTz);
  const rows = invitedPeople.map((p) => ({ p, status: attendeeStatus(p, busyIndex, start, end) }));
  const conflicts = rows.filter((r) => r.status !== "available").length;

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="mtg-title">
      <h2 id="mtg-title" className="text-base font-semibold">
        {title.trim() || "Untitled meeting"}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">{fmtDateLong(start, viewerTz)}</p>
      <p className="font-mono text-lg font-medium">{fmtRange(start, end, viewerTz)}</p>

      <h3 className="mt-4 text-sm font-semibold">Attendees ({rows.length})</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">No one is invited yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map(({ p, status }) => {
            const theirDate = localDateIso(start, p.timeZone);
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {p.name}
                    {p.isMe && <span className="font-normal text-ink-faint"> (you)</span>}
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
      )}

      {conflicts > 0 && (
        <p className="mt-2 text-xs text-busy-700">
          {conflicts} attendee{conflicts > 1 ? "s" : ""} can&apos;t make this time. You can still send the invite.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary flex-1" onClick={sendInvite} disabled={rows.length === 0}>
          <Icon name="send" className="h-4 w-4" />
          Send invite
        </button>
        <button type="button" className="btn-secondary" onClick={clearDraft}>
          Clear
        </button>
      </div>
    </section>
  );
}
