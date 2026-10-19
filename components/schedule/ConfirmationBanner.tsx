"use client";

import { useApp } from "../AppProvider";
import { Icon } from "../Icon";
import { fmtDate, fmtRange } from "@/lib/time";

export function ConfirmationBanner() {
  const { confirmation, dismissConfirmation, people } = useApp();
  if (!confirmation) return null;
  const { meeting, viewerTz } = confirmation;
  const start = Date.parse(meeting.startUtc);
  const end = Date.parse(meeting.endUtc);
  const names = people.filter((p) => meeting.attendeeIds.includes(p.id)).map((p) => (p.isMe ? "you" : p.firstName));

  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-accent-200 bg-accent-50 p-4 text-sm text-accent-800">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white">
        <Icon name="check" className="h-4 w-4" />
      </span>
      <div className="flex-1">
        <p className="font-semibold">Invite sent: {meeting.title}</p>
        <p>
          {fmtDate(start, viewerTz)}, <span className="font-mono">{fmtRange(start, end, viewerTz)}</span> with{" "}
          {names.join(", ")}. It now shows as busy on everyone&apos;s calendar.
        </p>
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
