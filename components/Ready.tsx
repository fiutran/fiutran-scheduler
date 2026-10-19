"use client";

import { useApp } from "./AppProvider";

/** Shows a skeleton until the calendar source has loaded. */
export function Ready({ children }: { children: React.ReactNode }) {
  const { ready } = useApp();
  if (ready) return <>{children}</>;
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading calendars…</span>
      <div className="h-24 animate-pulse rounded-xl bg-white" />
      <div className="h-80 animate-pulse rounded-xl bg-white" />
    </div>
  );
}
