"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./AppProvider";
import { Icon, type IconName } from "./Icon";
import { VIEWER_ZONES, tzAbbr } from "@/lib/time";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Schedule a meeting", icon: "calendar" },
  { href: "/team", label: "Team", icon: "users" },
  { href: "/profile", label: "My profile", icon: "user" },
];

export function Header() {
  const pathname = usePathname();
  const { viewerTz, setViewerTz, now, ready } = useApp();

  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-3 sm:px-6">
        <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-md">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 text-white">
            <Icon name="calendar" className="h-[18px] w-[18px]" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Fiutran Scheduler</span>
        </Link>
        <span className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-ink-soft">
          Prototype · sample data
        </span>

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="viewer-tz" className="flex items-center gap-1.5 whitespace-nowrap text-sm text-ink-soft">
            <Icon name="globe" className="h-4 w-4" />
            Show times in
          </label>
          <select
            id="viewer-tz"
            className="field w-auto min-w-[180px] font-medium"
            value={viewerTz}
            onChange={(e) => setViewerTz(e.target.value)}
            disabled={!ready}
          >
            {VIEWER_ZONES.map((z) => (
              <option key={z.tz} value={z.tz}>
                {z.label} ({ready ? tzAbbr(z.tz, now) : "…"})
              </option>
            ))}
          </select>
        </div>
      </div>

      <nav aria-label="Main" className="mx-auto max-w-[1440px] overflow-x-auto px-4 sm:px-6">
        <ul className="flex gap-1">
          {TABS.map((t) => {
            const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
                    active
                      ? "border-accent-600 text-accent-700"
                      : "border-transparent text-ink-soft hover:border-line hover:text-ink"
                  }`}
                >
                  <Icon name={t.icon} className="h-4 w-4" />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
