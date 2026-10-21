"use client";

import { useEffect, useState } from "react";
import { PROVIDERS, PROVIDER_LABEL, useApp } from "../AppProvider";
import { DateField } from "../DateField";
import { Icon, ProviderBadge } from "../Icon";
import { MultiSelect } from "../MultiSelect";
import { PROFILE_ZONES, fmtDate, fmtRange, fmtTime, minToHHMM, tzAbbr, zonedToUtc } from "@/lib/time";
import type { CalendarProvider } from "@/lib/types";

const STEPS = Array.from({ length: 49 }, (_, i) => i * 30); // 00:00 ... 24:00
const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

/** "Mon–Fri" for a consecutive run, otherwise a list like "Mon, Wed, Fri". */
function workDaysSummary(days: number[]): string {
  if (days.length === 0) return "No working days";
  const sorted = [...days].sort((a, b) => a - b);
  const names = sorted.map((d) => DAYS[d - 1][1]);
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  return consecutive && sorted.length > 2 ? `${names[0]}–${names[names.length - 1]}` : names.join(", ");
}

export function ProfileScreen() {
  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">My profile</h1>
        <p className="text-sm text-ink-faint">Changes apply immediately across the grid, suggestions and team cards.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <HoursCard />
        <CalendarsCard />
        <div className="lg:col-span-2">
          <TimeOffCard />
        </div>
      </div>
    </>
  );
}

function HoursCard() {
  const { me, updateMe, viewerTz, weekDays } = useApp();
  const [start, setStart] = useState(me.workStartMin);
  const [end, setEnd] = useState(me.workEndMin);
  const valid = end > start;

  function change(nextStart: number, nextEnd: number) {
    setStart(nextStart);
    setEnd(nextEnd);
    if (nextEnd > nextStart) updateMe({ workStartMin: nextStart, workEndMin: nextEnd });
  }

  function toggleDay(d: number) {
    const has = me.workDays.includes(d);
    updateMe({ workDays: has ? me.workDays.filter((x) => x !== d) : [...me.workDays, d].sort((a, b) => a - b) });
  }

  const ref = weekDays[0];
  const s = zonedToUtc(ref, me.workStartMin, me.timeZone);
  const e = zonedToUtc(ref, me.workEndMin, me.timeZone);

  return (
    <section className="card p-5" aria-labelledby="hours-title">
      <h2 id="hours-title" className="flex items-center gap-2 font-semibold">
        <Icon name="clock" className="h-4 w-4 text-accent-600" />
        Time zone and working hours
      </h2>

      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="my-tz" className="label mb-2 block">
            Time zone
          </label>
          <select id="my-tz" className="field" value={me.timeZone} onChange={(ev) => updateMe({ timeZone: ev.target.value })}>
            {PROFILE_ZONES.map((z) => (
              <option key={z.tz} value={z.tz}>
                {z.label} ({tzAbbr(z.tz, s)})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="wh-start" className="label mb-2 block">
              Start
            </label>
            <select
              id="wh-start"
              className="field font-mono"
              value={start}
              onChange={(ev) => change(Number(ev.target.value), end)}
              aria-invalid={!valid}
              aria-describedby="wh-error"
            >
              {STEPS.slice(0, -1).map((m) => (
                <option key={m} value={m}>
                  {minToHHMM(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="wh-end" className="label mb-2 block">
              End
            </label>
            <select
              id="wh-end"
              className="field font-mono"
              value={end}
              onChange={(ev) => change(start, Number(ev.target.value))}
              aria-invalid={!valid}
              aria-describedby="wh-error"
            >
              {STEPS.slice(1).map((m) => (
                <option key={m} value={m}>
                  {minToHHMM(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p id="wh-error" role={valid ? undefined : "alert"} className={`text-sm ${valid ? "text-ink-faint" : "font-medium text-busy-700"}`}>
          {valid
            ? me.timeZone === viewerTz
              ? `In ${tzAbbr(me.timeZone, s)}, your local time.`
              : `That's ${fmtRange(s, e, viewerTz)} in the zone you're viewing.`
            : "End time must be after the start time. Your previous hours are still in use."}
        </p>

        <MultiSelect
          label="Working days"
          options={DAYS.map(([d, label]) => ({ value: String(d), label }))}
          selected={me.workDays.map(String)}
          onToggle={(v) => toggleDay(Number(v))}
          summary={workDaysSummary(me.workDays)}
          placeholder="No working days"
        />
      </div>
    </section>
  );
}

const SIGN_IN: Record<CalendarProvider, string> = { google: "Google", outlook: "Microsoft" };

function resultMessage(p: CalendarProvider, result: string): { ok: boolean; text: string } | null {
  const label = PROVIDER_LABEL[p];
  const who = SIGN_IN[p];
  switch (result) {
    case "connected":
      return {
        ok: true,
        text: `${label} connected. Your real events now show on your row, and meetings you send can be added to it.`,
      };
    case "denied":
      return { ok: false, text: `${who} sign-in was cancelled. Nothing was connected.` };
    case "missing-permission":
      return { ok: false, text: `${who} didn't grant calendar access. Connect again and leave the calendar permission ticked.` };
    case "error":
      return { ok: false, text: `Couldn't connect to ${who}. Please try again.` };
    case "not-configured":
      return { ok: false, text: `Real ${label} sync isn't set up on this deployment yet, so it stays simulated.` };
    default:
      return null;
  }
}

function CalendarsCard() {
  const { connections, setConnection, me, live, anyLive, syncLive, viewerTz } = useApp();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Read and clear ?calendar=…&result=… left by the sign-in redirect.
  useEffect(() => {
    const url = new URL(window.location.href);
    const p = url.searchParams.get("calendar");
    const result = url.searchParams.get("result");
    if ((p !== "google" && p !== "outlook") || !result) return;
    setMessage(resultMessage(p, result));
    url.searchParams.delete("calendar");
    url.searchParams.delete("result");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  const anyConfigured = PROVIDERS.some((p) => live[p].configured);

  return (
    <section className="card p-5" aria-labelledby="cal-title">
      <h2 id="cal-title" className="flex items-center gap-2 font-semibold">
        <Icon name="link" className="h-4 w-4 text-accent-600" />
        Connected calendars
      </h2>
      {message && (
        <p
          role="status"
          className={`mt-3 rounded-lg border p-3 text-sm ${
            message.ok ? "border-accent-200 bg-accent-50 text-accent-800" : "border-busy-300 bg-busy-50 text-busy-700"
          }`}
        >
          {message.text}
        </p>
      )}
      <ul className="mt-3 divide-y divide-line">
        {(["outlook", "google"] as const).map((id) => {
          const sync = live[id];
          const on = connections[id];
          const real = sync.connected;
          const name = PROVIDER_LABEL[id];
          return (
            <li key={id} className="flex flex-wrap items-center gap-3 py-3">
              <ProviderBadge provider={id} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {name}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                      sync.configured ? "bg-accent-50 text-accent-700 ring-accent-200" : "bg-canvas text-ink-soft ring-line"
                    }`}
                  >
                    {sync.configured ? "Live" : "Sample"}
                  </span>
                </p>
                <p className="truncate text-sm text-ink-faint">
                  {on ? (
                    <>
                      <span className="text-accent-700">Connected</span> ·{" "}
                      {real ? sync.email : id === "outlook" ? me.email : me.email.replace("fiutran", "gmail")}
                    </>
                  ) : (
                    "Not connected"
                  )}
                </p>
                {!real && on && anyLive && (
                  <p className="text-xs text-ink-faint">Not shown while a real calendar is connected.</p>
                )}
                {real && (
                  <p className="text-xs text-ink-faint" aria-live="polite">
                    {sync.syncing ? (
                      "Syncing…"
                    ) : sync.error ? (
                      <span className="text-busy-700">{sync.error}</span>
                    ) : sync.lastSynced ? (
                      `Synced at ${fmtTime(sync.lastSynced, viewerTz)} ${tzAbbr(viewerTz, sync.lastSynced)}`
                    ) : null}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {real && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={syncLive}
                    disabled={sync.syncing}
                    aria-label={`Sync ${name} now`}
                  >
                    Sync now
                  </button>
                )}
                <button
                  type="button"
                  className={on ? "btn-secondary" : "btn-primary"}
                  onClick={() => setConnection(id, !on)}
                  aria-label={`${on ? "Disconnect" : "Connect"} ${name}`}
                >
                  {on ? "Disconnect" : "Connect"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 flex gap-2 rounded-lg bg-canvas p-3 text-sm text-ink-soft">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
        {anyConfigured ? (
          <span>
            Live calendars are real connections: Fiutran reads your events to find your busy times and adds the
            meetings you send (you pick which calendar when both are connected). Teammates are only named in the event
            description, so nobody is emailed. Sample calendars use made-up data.
          </span>
        ) : (
          <span>Read-only. Busy times sync automatically; nothing in your calendar is changed.</span>
        )}
      </p>
    </section>
  );
}

function TimeOffCard() {
  const { selectedDay, today, me, viewerTz, timeOff, addTimeOff, removeTimeOff } = useApp();
  const [day, setDay] = useState(selectedDay < today ? today : selectedDay);
  const [from, setFrom] = useState(14 * 60);
  const [to, setTo] = useState(19 * 60);
  const [reason, setReason] = useState("Not working");
  const [error, setError] = useState("");

  function add(ev: React.FormEvent) {
    ev.preventDefault();
    if (to <= from) {
      setError("“To” must be after “From”.");
      return;
    }
    setError("");
    addTimeOff({
      startUtc: new Date(zonedToUtc(day, from, me.timeZone)).toISOString(),
      endUtc: new Date(zonedToUtc(day, to, me.timeZone)).toISOString(),
      reason: reason.trim() || "Not working",
    });
  }

  return (
    <section className="card p-5" aria-labelledby="off-title">
      <h2 id="off-title" className="flex items-center gap-2 font-semibold">
        <Icon name="calendar" className="h-4 w-4 text-accent-600" />
        Block time off
      </h2>
      <p className="text-sm text-ink-faint">Entered in your time zone ({tzAbbr(me.timeZone, Date.now())}). Blocks show as busy in the grid.</p>

      <form onSubmit={add} className="mt-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_2fr_auto]" noValidate>
        <DateField label="Day" value={day} onChange={setDay} min={today} today={today} />
        <div>
          <label htmlFor="off-from" className="label mb-2 block">
            From
          </label>
          <select id="off-from" className="field font-mono" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {STEPS.slice(0, -1).map((m) => (
              <option key={m} value={m}>
                {minToHHMM(m)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="off-to" className="label mb-2 block">
            To
          </label>
          <select
            id="off-to"
            className="field font-mono"
            value={to}
            onChange={(e) => setTo(Number(e.target.value))}
            aria-invalid={!!error}
            aria-describedby={error ? "off-error" : undefined}
          >
            {STEPS.slice(1).map((m) => (
              <option key={m} value={m}>
                {minToHHMM(m)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="off-reason" className="label mb-2 block">
            Reason
          </label>
          <input id="off-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary">
          <Icon name="plus" className="h-4 w-4" />
          Add block
        </button>
      </form>
      {error && (
        <p id="off-error" role="alert" className="mt-2 text-sm font-medium text-busy-700">
          {error}
        </p>
      )}

      <h3 className="mt-6 text-sm font-semibold">Your blocks</h3>
      {timeOff.length === 0 ? (
        <p className="mt-1 text-sm text-ink-faint">No time off yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {timeOff.map((b) => {
            const s = Date.parse(b.startUtc);
            const e = Date.parse(b.endUtc);
            return (
              <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                <span className="h-6 w-1.5 shrink-0 rounded-full bg-busy-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{b.reason}</p>
                  <p className="font-mono text-xs text-ink-soft">
                    {fmtDate(s, me.timeZone)} · {fmtRange(s, e, me.timeZone)}
                    {viewerTz !== me.timeZone && (
                      <span className="text-ink-faint">
                        {" "}
                        · {fmtDate(s, viewerTz) !== fmtDate(s, me.timeZone) && `${fmtDate(s, viewerTz)} `}
                        {fmtRange(s, e, viewerTz)}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => removeTimeOff(b.id)}
                  aria-label={`Remove ${b.reason} on ${fmtDate(s, me.timeZone)}`}
                >
                  <Icon name="trash" className="h-4 w-4" />
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
