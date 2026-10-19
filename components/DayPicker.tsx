"use client";

import { parseISO, format } from "date-fns";
import { useApp } from "./AppProvider";

export function DayPicker({ id = "day" }: { id?: string }) {
  const { weekDays, selectedDay, setSelectedDay } = useApp();
  return (
    <div role="group" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="label mb-2">
        Day
      </p>
      <div className="flex flex-wrap gap-2">
        {weekDays.map((d) => {
          const date = parseISO(d);
          return (
            <button
              key={d}
              type="button"
              className="chip"
              aria-pressed={d === selectedDay}
              onClick={() => setSelectedDay(d)}
            >
              <span>{format(date, "EEE")}</span>
              <span className="font-mono text-xs opacity-80">{format(date, "d MMM")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
