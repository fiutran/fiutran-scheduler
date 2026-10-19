"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { busyAt, cellState, isWorking, type CellState } from "@/lib/availability";
import { SLOT_MS, dayCells, fmtDate, fmtRange, fmtTime, localParts, minToHHMM, tzAbbr } from "@/lib/time";
import type { Person } from "@/lib/types";

const CELL_CLASS: Record<CellState, string> = {
  free: "bg-white hover:bg-accent-50",
  busy: "bg-busy-400 hover:bg-busy-300",
  off: "hatch hover:brightness-95",
};
const STATE_LABEL: Record<CellState, string> = { free: "Free", busy: "Busy", off: "Outside working hours" };

type Hover = { row: string; idx: number } | null;

export function AvailabilityGrid({ invitedPeople }: { invitedPeople: Person[] }) {
  const { busyIndex, viewerTz, selectedDay, selectionStart, setSelectionStart, durationMin, now } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [focusIdx, setFocusIdx] = useState(0);

  const cells = useMemo(() => dayCells(selectedDay, viewerTz), [selectedDay, viewerTz]);

  const states = useMemo(
    () => invitedPeople.map((p) => cells.map((c) => cellState(p, busyIndex, c))),
    [invitedPeople, cells, busyIndex],
  );
  const freeCounts = useMemo(
    () => cells.map((_, i) => states.reduce((n, row) => n + (row[i] === "free" ? 1 : 0), 0)),
    [cells, states],
  );

  const total = invitedPeople.length;
  const durCells = durationMin / 30;
  const selIdx = selectionStart === null ? -1 : cells.indexOf(selectionStart);
  const nowIdx = now >= cells[0] && now < cells[cells.length - 1] + SLOT_MS ? Math.floor((now - cells[0]) / SLOT_MS) : -1;

  // Scroll so the earliest working half-hour among invitees is near the left edge.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Start where at least half the invitees are working, so a far-off zone doesn't drag the view to midnight.
    const need = Math.max(1, Math.ceil(invitedPeople.length / 2));
    let first = cells.findIndex((c) => invitedPeople.filter((p) => isWorking(p, c, c + SLOT_MS)).length >= need);
    if (first < 0) first = 16;
    const cell = el.querySelector<HTMLElement>(`[data-idx="${Math.max(0, first - 1)}"]`);
    const nameCol = el.querySelector<HTMLElement>("[data-namecol]");
    if (cell && nameCol) el.scrollTo({ left: cell.offsetLeft - nameCol.offsetWidth, behavior: "smooth" });
    setFocusIdx(Math.max(0, first));
    // Only re-run when the visible day, zone or invite list changes, not on every busy update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, viewerTz, invitedPeople.map((p) => p.id).join(",")]);

  const viewerAbbr = tzAbbr(viewerTz, cells[0]);

  function describe(row: string, idx: number): string {
    const start = cells[idx];
    const range = fmtRange(start, start + SLOT_MS, viewerTz);
    if (row === "everyone") {
      const missing = invitedPeople.filter((_, r) => states[r][idx] !== "free");
      return `Everyone · ${range} · ${freeCounts[idx]} of ${total} free${
        missing.length ? ` · Not free: ${missing.map((p) => p.firstName).join(", ")}` : ""
      }`;
    }
    const r = invitedPeople.findIndex((p) => p.id === row);
    const p = invitedPeople[r];
    const state = states[r][idx];
    const local = p.timeZone === viewerTz ? "" : ` (${fmtTime(start, p.timeZone)} ${tzAbbr(p.timeZone, start)} local)`;
    let status = STATE_LABEL[state];
    // Only your own row reveals what you're busy with; everyone else just reads "Busy".
    if (state === "busy" && p.isMe) status = `Busy: ${busyAt(busyIndex, p.id, start, start + SLOT_MS)?.title ?? "Busy"}`;
    return `${p.isMe ? "You" : p.name} · ${range}${local} · ${status}`;
  }

  function onEveryoneKey(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    let next = idx;
    if (e.key === "ArrowRight") next = Math.min(cells.length - 1, idx + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, idx - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = cells.length - 1;
    else return;
    e.preventDefault();
    setFocusIdx(next);
    scrollRef.current?.querySelector<HTMLButtonElement>(`[data-everyone="${next}"]`)?.focus();
  }

  const hoverText = hover ? describe(hover.row, hover.idx) : null;

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="grid-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="grid-title" className="text-base font-semibold">
            Availability · {fmtDate(cells[0], viewerTz)}
          </h2>
          <p className="text-sm text-ink-faint">
            Times in {viewerAbbr}. Click any cell to start a {durationMin}-minute meeting there.
          </p>
        </div>
        <Legend />
      </div>

      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-ink-soft">
          Invite at least one person to see availability.
        </p>
      ) : (
        <div ref={scrollRef} className="relative overflow-x-auto rounded-lg border border-line" onMouseLeave={() => setHover(null)}>
          <div className="relative w-max">
            {/* Hour labels */}
            <div className="flex border-b border-line bg-canvas">
              <div data-namecol className="sticky left-0 z-20 w-[var(--name-w)] shrink-0 border-r border-line bg-canvas" />
              {cells.map((c, i) => {
                const { minute } = localParts(c, viewerTz);
                return (
                  <div key={c} className="relative h-8 w-[var(--cell-w)] shrink-0" aria-hidden="true">
                    {minute % 60 === 0 && (
                      <span className="absolute left-1 top-2 font-mono text-[11px] text-ink-faint">
                        {fmtTime(c, viewerTz)}
                      </span>
                    )}
                    {i === nowIdx && <span className="absolute bottom-0 left-0 h-2 w-0.5 bg-ink" />}
                  </div>
                );
              })}
            </div>

            {/* One row per person */}
            {invitedPeople.map((p, r) => (
              <div key={p.id} className="flex border-b border-line">
                <div className="sticky left-0 z-10 flex w-[var(--name-w)] shrink-0 items-center gap-2 border-r border-line bg-white px-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {p.firstName}
                      {p.isMe && <span className="font-normal text-ink-faint"> (you)</span>}
                    </p>
                    <p className="truncate font-mono text-[11px] text-ink-faint">
                      {tzAbbr(p.timeZone, cells[0])} · {minToHHMM(p.workStartMin)}–{minToHHMM(p.workEndMin)}
                    </p>
                  </div>
                </div>
                {cells.map((c, i) => {
                  const state = states[r][i];
                  const text = describe(p.id, i);
                  return (
                    <button
                      key={c}
                      type="button"
                      tabIndex={-1}
                      data-idx={i}
                      title={text}
                      aria-label={text}
                      onClick={() => setSelectionStart(c)}
                      onMouseEnter={() => setHover({ row: p.id, idx: i })}
                      className={`h-11 w-[var(--cell-w)] shrink-0 ${hourBorder(c, viewerTz)} ${CELL_CLASS[state]}`}
                    />
                  );
                })}
              </div>
            ))}

            {/* Combined row */}
            <div className="flex">
              <div className="sticky left-0 z-10 flex w-[var(--name-w)] shrink-0 items-center border-r border-line bg-white px-3">
                <p className="text-sm font-semibold">Everyone</p>
              </div>
              {cells.map((c, i) => {
                const n = freeCounts[i];
                const cls =
                  n === total
                    ? "bg-accent-600 hover:bg-accent-700"
                    : total > 1 && n === total - 1
                      ? "bg-accent-200 hover:bg-accent-100"
                      : "bg-[#e3e6ea] hover:bg-[#d6dae0]";
                const text = describe("everyone", i);
                return (
                  <button
                    key={c}
                    type="button"
                    data-everyone={i}
                    tabIndex={i === focusIdx ? 0 : -1}
                    title={text}
                    aria-label={`Select ${text}`}
                    onClick={() => setSelectionStart(c)}
                    onFocus={() => setHover({ row: "everyone", idx: i })}
                    onKeyDown={(e) => onEveryoneKey(e, i)}
                    onMouseEnter={() => setHover({ row: "everyone", idx: i })}
                    className={`h-11 w-[var(--cell-w)] shrink-0 border-r border-white/60 ${cls}`}
                  />
                );
              })}
            </div>

            {/* Selected range, drawn across all rows */}
            {selIdx >= 0 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 top-8 z-[5] rounded-[3px] border-2 border-accent-700 bg-accent-600/10 shadow-[0_0_0_3px_rgba(31,95,214,0.18)]"
                style={{
                  left: `calc(var(--name-w) + ${selIdx} * var(--cell-w))`,
                  width: `calc(${Math.min(durCells, cells.length - selIdx)} * var(--cell-w))`,
                }}
              />
            )}
            {nowIdx >= 0 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 top-8 z-[4] w-0.5 bg-ink/70"
                style={{ left: `calc(var(--name-w) + ${(now - cells[0]) / SLOT_MS} * var(--cell-w))` }}
              />
            )}
          </div>
        </div>
      )}

      <p className="mt-3 min-h-5 font-mono text-xs text-ink-soft" aria-live="polite">
        {hoverText ?? "Hover a cell for details. Keyboard: Tab to the Everyone row, then use the arrow keys."}
      </p>
    </section>
  );
}

function hourBorder(c: number, tz: string): string {
  // Darker line on the hour, lighter on the half hour.
  return localParts(c + SLOT_MS, tz).minute % 60 === 0 ? "border-r border-[#c9cfd6]" : "border-r border-[#eceef1]";
}

function Legend() {
  const items: [string, string][] = [
    ["bg-white ring-1 ring-inset ring-line", "Free"],
    ["bg-busy-400", "Busy"],
    ["hatch ring-1 ring-inset ring-line", "Off hours"],
    ["bg-accent-600", "All free"],
    ["bg-accent-200", "All but one"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
      {items.map(([cls, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`inline-block h-3.5 w-3.5 rounded-sm ${cls}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
