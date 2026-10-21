"use client";

import { useEffect, useId, useRef, useState } from "react";
import { addDays, addMonths, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { Icon } from "./Icon";

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

type Props = {
  /** Visible label above the button. */
  label: string;
  /** Selected date as yyyy-MM-dd. */
  value: string;
  onChange: (dateIso: string) => void;
  /** Earliest selectable date (yyyy-MM-dd); earlier days are greyed out. */
  min?: string;
  /** Today's date (yyyy-MM-dd), outlined in the calendar. */
  today?: string;
};

/** A button showing the date that opens a month calendar pop-up. Keyboard: arrows move, Enter picks, Esc closes. */
export function DateField({ label, value, onChange, min, today }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(value)));
  const [focus, setFocus] = useState(value);
  const wrap = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setMonth(startOfMonth(parseISO(value)));
    setFocus(value);
    const onDown = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, value]);

  // Keep keyboard focus on the highlighted day while the pop-up is open.
  useEffect(() => {
    if (open) gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();
  }, [open, focus, month]);

  const first = startOfWeek(month, { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const disabled = (d: string) => Boolean(min && d < min);

  function pick(d: string) {
    if (disabled(d)) return;
    onChange(d);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      wrap.current?.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (step[e.key]) {
      e.preventDefault();
      const next = addDays(parseISO(focus), step[e.key]);
      if (!isSameMonth(next, month)) setMonth(startOfMonth(next));
      setFocus(iso(next));
    }
  }

  return (
    <div ref={wrap} className="relative">
      <p id={`${id}-label`} className="label mb-2">
        {label}
      </p>
      <button
        type="button"
        className="field flex min-w-[180px] items-center gap-2 text-left"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="calendar" className="h-4 w-4 text-ink-faint" />
        <span id={`${id}-value`} className="flex-1">
          {format(parseISO(value), "EEE d MMM yyyy")}
        </span>
        <span className="text-ink-faint" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()}`}
          className="absolute left-0 top-full z-40 mt-2 w-[296px] rounded-xl border border-line bg-white p-3 shadow-lg"
          onKeyDown={onKey}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-canvas"
              aria-label="Previous month"
              onClick={() => setMonth((m) => addMonths(m, -1))}
            >
              ‹
            </button>
            <p className="text-sm font-semibold" aria-live="polite">
              {format(month, "MMMM yyyy")}
            </p>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-canvas"
              aria-label="Next month"
              onClick={() => setMonth((m) => addMonths(m, 1))}
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-ink-faint" aria-hidden="true">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div ref={gridRef} role="grid" aria-label={format(month, "MMMM yyyy")} className="grid grid-cols-7 gap-0.5">
            {days.map((d) => {
              const k = iso(d);
              const inMonth = isSameMonth(d, month);
              const selected = k === value;
              const off = disabled(k);
              return (
                <button
                  key={k}
                  type="button"
                  data-date={k}
                  tabIndex={k === focus ? 0 : -1}
                  disabled={off}
                  aria-pressed={selected}
                  aria-label={format(d, "EEEE d MMMM yyyy")}
                  onClick={() => pick(k)}
                  className={`h-9 rounded-lg font-mono text-sm transition-colors ${
                    selected
                      ? "bg-accent-600 font-semibold text-white"
                      : off
                        ? "cursor-not-allowed text-ink-faint/40"
                        : `hover:bg-accent-50 ${inMonth ? "text-ink" : "text-ink-faint"}`
                  } ${k === today && !selected ? "ring-1 ring-inset ring-accent-600" : ""}`}
                >
                  {format(d, "d")}
                </button>
              );
            })}
          </div>
          {today && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-accent-700 hover:bg-accent-50"
                onClick={() => pick(today)}
              >
                Today
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
