import type { AttendeeStatus } from "@/lib/availability";

const STYLES: Record<AttendeeStatus, [string, string]> = {
  available: ["bg-accent-50 text-accent-700 ring-accent-200", "Available"],
  busy: ["bg-busy-50 text-busy-700 ring-busy-300", "Busy"],
  off: ["bg-canvas text-ink-soft ring-line", "Off hours"],
};

export function StatusChip({ status }: { status: AttendeeStatus }) {
  const [cls, label] = STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}
