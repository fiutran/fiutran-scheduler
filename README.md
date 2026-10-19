# Fiutran Scheduler (prototype)

Clickable prototype of a team meeting scheduler. **Sample data only**: no calendar connections, database, auth or backend.

```bash
cd fiutran-scheduler
npm install
npm run dev      # http://localhost:3000
```

Stack: Next.js (App Router), TypeScript, Tailwind CSS, `date-fns-tz` for IANA time zones (daylight saving handled).

## Where things live

| Path | What |
|---|---|
| `lib/calendarSource.ts` | **The only data entry point.** `getPeople()` and `getBusyEvents(personId, rangeStartUtc, rangeEndUtc)`. Returns sample data today. |
| `lib/mockData.ts` | Sample team and a week of events, written in each person's local time and converted to UTC. Only imported by `calendarSource.ts`. |
| `lib/availability.ts` | Free / busy / off-hours logic and suggested-time search. Pure functions, UTC in, UTC out. |
| `lib/time.ts` | Time zone helpers: conversion, formatting, abbreviations. |
| `components/AppProvider.tsx` | React context: loaded data, viewer time zone, profile edits, sent meetings, time-off blocks, calendar connections. |
| `app/` | Routes: `/` Schedule a meeting, `/team`, `/profile`. |

All event times are stored as UTC and converted only for display.

## Connecting real calendars later

Only `lib/calendarSource.ts` changes (plus a server route for tokens):

1. **Auth**: add Microsoft (Entra ID) and Google OAuth sign-in with read-only scopes (`Calendars.Read`, `https://www.googleapis.com/auth/calendar.freebusy`). Keep tokens server-side in a Next.js route handler.
2. **`getPeople()`**: read the team from Microsoft Graph `/users` or Google Directory, merged with each person's saved profile (time zone, working hours). Graph `mailboxSettings` already holds working hours and time zone.
3. **`getBusyEvents()`**: Outlook → `POST /me/calendar/getSchedule`; Google → `POST /calendar/v3/freeBusy`. Both return UTC busy intervals without titles for other people, which the UI already assumes. Fetch through a server route; cache per person and week.
4. **Persistence**: profile changes, time-off blocks and "Send invite" are in React state now. Save them in a database, and have Send invite create a real event (Graph `POST /me/events` or Google `events.insert`), which needs write scope.
5. **Sync**: Graph change notifications / Google push channels, or polling, to keep busy times fresh.
