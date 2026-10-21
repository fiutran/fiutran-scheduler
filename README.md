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

## Real calendars: Google and Outlook (two-way, optional)

With the env vars in `.env.example` set, **My profile → Connect** signs in for real (each provider is independent):

- **Read:** your timed events show as busy on your row (titles visible only to you). All-day, "free" and declined events are ignored. Re-syncs when you return to the tab, or with **Sync now**.
- **Write:** **Send invite** adds the meeting to your calendar. With both connected, choose **Add to: Google Calendar / Outlook** (remembered). Teammates are named in the description only, never added as guests, so nobody is emailed.
- Delete or move the event in your calendar and your row updates on the next sync.
- Your row shows only real data once any real calendar is connected; your name comes from that account.
- Tokens are kept in encrypted, httpOnly cookies (AES-256-GCM, keyed by `AUTH_SECRET`). **Disconnect** forgets them (and revokes at Google).
- The other teammates stay sample data, labelled as such on the Team screen.

Code: `lib/server/providers.ts` (one adapter per provider), `app/api/[provider]/*` (connect, callback, status, events, disconnect), client calls in `lib/calendarSource.ts`.

### Google setup

1. [Google Cloud console](https://console.cloud.google.com/): create a project and enable the **Google Calendar API**.
2. **Google Auth Platform**: Branding (app name, emails), Audience **External** in **Testing** with your Gmail under **Test users**, Data access scope `https://www.googleapis.com/auth/calendar.events`.
3. **Clients → Create client → Web application**, redirect URI `https://<your-site>/api/google/callback` (and `http://localhost:3000/api/google/callback` for local).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, then redeploy.

### Outlook setup (Microsoft Entra)

1. [Azure portal](https://portal.azure.com/) → **Microsoft Entra ID → App registrations → New registration**.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI: platform **Web**, `https://<your-site>/api/outlook/callback`.
2. **API permissions → Add → Microsoft Graph → Delegated**: `Calendars.ReadWrite`, `User.Read`, `offline_access`, `openid`, `profile`, `email`.
3. **Certificates & secrets → New client secret**; copy the **Value** (shown once).
4. Set `MICROSOFT_CLIENT_ID` (the Application (client) ID) and `MICROSOFT_CLIENT_SECRET`, then redeploy. `AUTH_SECRET` is shared with Google.

Personal accounts (outlook.com, hotmail, live) can connect straight away. A work or school account may need its IT admin to approve the app once.

## Connecting real calendars later

Only `lib/calendarSource.ts` changes (plus a server route for tokens):

1. **Auth**: add Microsoft (Entra ID) and Google OAuth sign-in with read-only scopes (`Calendars.Read`, `https://www.googleapis.com/auth/calendar.freebusy`). Keep tokens server-side in a Next.js route handler.
2. **`getPeople()`**: read the team from Microsoft Graph `/users` or Google Directory, merged with each person's saved profile (time zone, working hours). Graph `mailboxSettings` already holds working hours and time zone.
3. **`getBusyEvents()`**: Outlook → `POST /me/calendar/getSchedule`; Google → `POST /calendar/v3/freeBusy`. Both return UTC busy intervals without titles for other people, which the UI already assumes. Fetch through a server route; cache per person and week.
4. **Persistence**: profile changes, time-off blocks and "Send invite" are in React state now. Save them in a database, and have Send invite create a real event (Graph `POST /me/events` or Google `events.insert`), which needs write scope.
5. **Sync**: Graph change notifications / Google push channels, or polling, to keep busy times fresh.
