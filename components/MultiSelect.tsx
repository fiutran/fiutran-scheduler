"use client";

import { useEffect, useId, useRef, useState } from "react";

export type Option = { value: string; label: string; hint?: string };

type Props = {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Text for the closed button; defaults to the selected labels. */
  summary?: string;
  placeholder?: string;
};

/** A dropdown with a checklist inside, for picking several items without a row of chips. */
export function MultiSelect({ label, options, selected, onToggle, summary, placeholder = "None selected" }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    wrap.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const text =
    summary ??
    (selected.length
      ? options
          .filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join(", ")
      : placeholder);

  return (
    <div ref={wrap} className="relative">
      <p id={`${id}-label`} className="label mb-2">
        {label}
      </p>
      <button
        type="button"
        className="field flex min-w-[220px] max-w-full items-center gap-2 text-left"
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen((o) => !o)}
      >
        <span id={`${id}-value`} className="flex-1 truncate">
          {text}
        </span>
        <span className="text-ink-faint" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-2 min-w-full rounded-xl border border-line bg-white p-1.5 shadow-lg"
          role="group"
          aria-labelledby={`${id}-label`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              wrap.current?.querySelector<HTMLButtonElement>("button")?.focus();
            }
          }}
        >
          {options.map((o) => (
            <label
              key={o.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm hover:bg-canvas"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent-600"
                checked={selected.includes(o.value)}
                onChange={() => onToggle(o.value)}
              />
              <span className="flex-1 whitespace-nowrap">{o.label}</span>
              {o.hint && <span className="font-mono text-xs text-ink-faint">{o.hint}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
