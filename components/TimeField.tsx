"use client";

import { useEffect, useState } from "react";
import { minToHHMM, parseTime } from "@/lib/time";

/** Half-hour suggestions shown in the field's dropdown. */
const SUGGESTIONS = Array.from({ length: 48 }, (_, i) => minToHHMM(i * 30));

type Props = {
  id: string;
  /** Current time as "HH:mm", or "" when unset. */
  value: string;
  /** Called with minutes after midnight once the entry is a complete, valid time. */
  onCommit: (minutes: number) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
};

/** A 24-hour time input (browsers' own time pickers follow the OS and may show AM/PM). */
export function TimeField({ id, value, onCommit, disabled, invalid, describedBy }: Props) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value);
    setBad(false);
  }, [value]);

  function change(next: string) {
    setText(next);
    setBad(false);
    const minutes = parseTime(next, false);
    if (minutes !== null) onCommit(minutes);
  }

  function finish() {
    if (!text.trim()) return setText(value);
    const minutes = parseTime(text, true);
    if (minutes === null) return setBad(true);
    setText(minToHHMM(minutes));
    if (minToHHMM(minutes) !== value) onCommit(minutes);
  }

  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:MM"
        maxLength={8}
        list={`${id}-list`}
        className={`field w-[112px] font-mono ${bad ? "border-busy-400" : ""}`}
        value={text}
        disabled={disabled}
        onChange={(e) => change(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => e.key === "Enter" && finish()}
        aria-invalid={invalid || bad}
        aria-describedby={describedBy}
        title={bad ? "Use 24-hour time, like 09:30 or 14:00" : "24-hour time, e.g. 14:30"}
      />
      <datalist id={`${id}-list`}>
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
