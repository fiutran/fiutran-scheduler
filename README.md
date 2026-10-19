# Fiutran Scheduler (prototype)

Clickable prototype of a team meeting scheduler. Runs on **sample data**, with an optional **real, two-way Google Calendar** connection for "you" (see below). No database.

```bash
cd fiutran-scheduler
npm install
npm run dev      # http://localhost:3000
```

Stack: Next.js (App Router), TypeScript, Tailwind CSS, `date-fns-tz` for IANA time zones (daylight saving handled).

## Where things live

| Path | What |
|---|---|
| `lib/calendarSource.ts` | **The only data entry point.** `getPeople()` and `getBusyEvents(personId, rangeStartUtc, rangeEndUtc)` (sample data), plus the real Google read/write calls. |
| `app/api/google/*`, `lib/server/googleAuth.ts` | Server side of the Google connection: OAuth, token refresh, encrypted cookie, Calendar API calls. |
| `lib/mockData.ts` | Sample team and a week of events, written in each person's local time and converted to UTC. Only imported by `calendarSource.ts`. |
| `lib/availability.ts` | Free / busy / off-hours logic and suggested-time search. Pure functions, UTC in, UTC out. |
| `lib/time.ts` | Time zone helpers: conversion, formatting, abbreviations. |
| `components/AppProvider.tsx` | React context: loaded data, viewer time zone, profile edits, sent meetings, time-off blocks, calendar connections. |
| `app/` | Routes: `/` Schedule a meeting, `/team`, `/profile`. |

All event times are stored as UTC and converted only for display.

## Real Google Calendar (two-way, optional)

When the three env vars in `.env.example` are set, **My profile → Google Calendar → Connect** signs in with Google for real:

- **Read:** your timed events from your primary calendar show as busy on your row (titles visible only to you). All-day events, events marked "Free" and events you declined are ignored. Re-syncs when you return to the tab, or with **Sync now**.
- **Write:** **Send invite** adds the meeting to your Google Calendar (`sendUpdates=none`). Sample teammates are named in the description only, never added as guests, so Google emails no one.
- Delete or move the event in Google and your row updates on the next sync.
- Tokens are kept in an encrypted, httpOnly cookie (AES-256-GCM, keyed by `AUTH_SECRET`). **Disconnect** revokes access at Google.
- Your row then shows only your real data: your name comes from your Google account, and none of the sample events for "you" are shown.
- Outlook and the other four teammates (Aarti, Lena, Arjun, Maya) stay sample data, labelled as such on the Team screen.

Setup (about 10 minutes):

1. [Google Cloud console](https://console.cloud.google.com/): create a project and enable the **Google Calendar API**.
2. **OAuth consent screen** (Google Auth Platform → Branding / Audience): user type **External**, leave it in **Testing**, and add your Gmail address under **Test users**.
3. **Data access**: add the scope `https://www.googleapis.com/auth/calendar.events`.
4. **Clients → Create client → Web application**. Authorized redirect URIs, one per site you'll test on:
   - `http://localhost:3000/api/google/callback`
   - `https://<your-vercel-url>/api/google/callback`
5. Put the client ID and secret, plus a random `AUTH_SECRET`, in `.env.local` (local) or in Vercel's Environment Variables, then redeploy.

While the app is in Testing mode Google shows a "Google hasn't verified this app" warning (choose Continue), only listed test users can sign in, and the connection expires after 7 days.

## Connecting real calendars later

Only `lib/calendarSource.ts` changes (plus a server route for tokens):

1. **Auth**: add Microsoft (Entra ID) and Google OAuth sign-in with read-only scopes (`Calendars.Read`, `https://www.googleapis.com/auth/calendar.freebusy`). Keep tokens server-side in a Next.js route handler.
2. **`getPeople()`**: read the team from Microsoft Graph `/users` or Google Directory, merged with each person's saved profile (time zone, working hours). Graph `mailboxSettings` already holds working hours and time zone.
3. **`getBusyEvents()`**: Outlook → `POST /me/calendar/getSchedule`; Google → `POST /calendar/v3/freeBusy`. Both return UTC busy intervals without titles for other people, which the UI already assumes. Fetch through a server route; cache per person and week.
4. **Persistence**: profile changes, time-off blocks and "Send invite" are in React state now. Save them in a database, and have Send invite create a real event (Graph `POST /me/events` or Google `events.insert`), which needs write scope.
5. **Sync**: Graph change notifications / Google push channels, or polling, to keep busy times fresh.
