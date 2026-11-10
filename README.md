# Fiutran Scheduler (prototype)

Team meeting scheduler for Fiutran (prototype). The team is **Diksha** (ms.dikshasharmaa@gmail.com, Google Calendar) and **Aarti** (letstalk@fiutran.com, Outlook). There is **no sample data**: busy times come only from real, two-way calendar connections and meetings or time off created in the app. With the shared database (see "Team sharing"), everyone sees each other's real availability, including iCloud.

```bash
cd fiutran-scheduler
npm install
npm run dev      # http://localhost:3000
```

Stack: Next.js (App Router), TypeScript, Tailwind CSS, `date-fns-tz` for IANA time zones (daylight saving handled).

## Where things live

| Path | What |
|---|---|
| `lib/team.ts` | The team: names, emails, time zones, working hours. Whoever connects a calendar is matched to their row by email. |
| `lib/calendarSource.ts` | **The only client data entry point.** Calls for connecting calendars, reading and writing events, and the team endpoints. |
| `app/api/[provider]/*`, `lib/server/providers.ts`, `lib/server/icloud.ts` | Server side of the calendar connections: OAuth (Google, Outlook), CalDAV (iCloud), token refresh, calendar API calls. |
| `app/api/team/*`, `app/api/meetings`, `lib/server/store.ts`, `lib/server/db.ts` | Team sharing: shared busy times, time off, meetings and the change counter, stored in the database. |
| `lib/availability.ts` | Free / busy / off-hours logic and suggested-time search. Pure functions, UTC in, UTC out. |
| `lib/time.ts` | Time zone helpers: conversion, formatting, abbreviations. |
| `components/AppProvider.tsx` | React context: loaded data, viewer time zone, profile edits, sent meetings, time-off blocks, calendar connections. |
| `app/` | Routes: `/` Schedule a meeting, `/team`, `/profile`. |

All event times are stored as UTC and converted only for display.

## Real calendars: Google, Outlook and iCloud (two-way)

With the env vars in `.env.example` set, **My profile → Connect** signs in for real (each provider is independent):

- **Read:** your timed events show as busy on your row (titles visible only to you). All-day, "free" and declined events are ignored. Syncs automatically (see "Live sync").
- **Write:** **Send invite** adds the meeting to your calendar. With both connected, choose **Add to: Google Calendar / Outlook** (remembered). Teammates are named in the description only, never added as guests, so nobody is emailed.
- Delete or move the event in your calendar and your row updates on the next sync.
- Your row shows only real data once any real calendar is connected; your name comes from that account.
- Tokens are kept in encrypted, httpOnly cookies (AES-256-GCM, keyed by `AUTH_SECRET`). **Disconnect** forgets them (and revokes at Google).
- Without the shared database, your calendar shows only in your own browser and teammates show as "Not shared yet". With it, see "Team sharing".

Code: `lib/server/providers.ts` (one adapter per provider), `app/api/[provider]/*` (connect, callback, status, events, disconnect), client calls in `lib/calendarSource.ts`.

### Google setup

1. [Google Cloud console](https://console.cloud.google.com/): create a project and enable the **Google Calendar API**.
2. **Google Auth Platform**: Branding (app name, emails), Audience **External** in **Testing** with your Gmail under **Test users**, Data access scope `https://www.googleapis.com/auth/calendar.events`.
3. **Clients → Create client → Web application**, redirect URI `https://<your-site>/api/google/callback` (and `http://localhost:3000/api/google/callback` for local).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, then redeploy.
5. **Publish the app** (Google Auth Platform → Audience → **Publish app**). While it stays in **Testing**, only listed test users can connect and Google expires each connection after 7 days, so everyone has to reconnect weekly. Because the app can edit calendars, Google may ask for verification; until then people see an "unverified app" warning they can click past.

### Team sharing (shared database)

Without a database, each person's real calendar shows only in their own browser. With it:

- Each person connects their calendars once (Diksha: Google; Aarti: Outlook and iCloud). Connections are stored **encrypted** in the database, per team member.
- Everyone sees everyone's real busy times; meeting titles stay private to their owner.
- **Send invite** saves the meeting and adds it quietly (no emails) to each attendee's main calendar: Diksha → Google, Aarti → Outlook. The organiser can pick another of their own calendars with **Add to** (including iCloud).
- Deleting the meeting in your own calendar frees you in the app; adding, moving or deleting events in any connected calendar shows up on the next sync.
- Only team members can see team data: connecting a calendar with a team email signs you in. Other accounts are refused.

- **Block time off** is saved to the database too: teammates see it as busy (the reason stays private to you), and it survives a page reload.

### Live sync

While the app is open and visible, it syncs on its own:

- Every **10 seconds** it checks a change counter in the database (one tiny read). Anything a teammate does in the app (adds or removes time off, sends a meeting, connects or disconnects a calendar) shows up within about 10 seconds.
- Every **60 seconds** it re-reads everyone's calendars, for events added, moved or deleted directly in Google Calendar, Outlook or iCloud.
- A hidden tab doesn't poll; it catches up the moment you switch back to it.

Code: `teamVersion` / `bumpVersion` in `lib/server/store.ts`, `app/api/team/version`, `app/api/team/timeoff`, and the live-sync effect in `components/AppProvider.tsx` (`CHANGE_POLL_MS`, `FULL_SYNC_MS`).

Setup: Vercel → project → **Storage** → **Create** → **Upstash for Redis** (free plan) → connect it to the project (adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`) → redeploy. Then each person reconnects their calendars once on **My profile**.

### Repeating meetings

**Repeat** (next to Length): every weekday, daily, weekly, every 2 weeks or monthly, for 2–52 meetings. A series is anchored to the organiser's time zone, so it stays at the same local time across daylight-saving changes (`lib/recurrence.ts`).

- Google Calendar and Outlook get a native series (RRULE / Graph recurrence), editable as one in those apps. Outlook is sent Windows time-zone names (e.g. "India Standard Time").
- iCloud gets one event per date (exact times without hand-built VTIMEZONE data).
- Cancelling one occurrence in your calendar frees just that date in the app.
- Availability and suggestions check the first meeting's date; later dates show on the grid and Team calendars when you browse to them.

### iCloud setup (per person, needs team sharing)

Apple has no sign-in page for calendar access. On **My profile → iCloud Calendar → Connect**, enter your Apple ID and an **app-specific password** created at account.apple.com (Sign-In and Security → App-Specific Passwords). It's stored encrypted; revoke it at Apple to cut access. The app uses CalDAV (caldav.icloud.com) to read events (repeating events expanded by iCloud) and to create meetings when iCloud is chosen in **Add to**.

### Outlook setup (Microsoft Entra)

1. [Azure portal](https://portal.azure.com/) → **Microsoft Entra ID → App registrations → New registration**.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI: platform **Web**, `https://<your-site>/api/outlook/callback`.
2. **API permissions → Add → Microsoft Graph → Delegated**: `Calendars.ReadWrite`, `User.Read`, `offline_access`, `openid`, `profile`, `email`.
3. **Certificates & secrets → New client secret**; copy the **Value** (shown once).
4. Set `MICROSOFT_CLIENT_ID` (the Application (client) ID) and `MICROSOFT_CLIENT_SECRET`, then redeploy. `AUTH_SECRET` is shared with Google.

Personal accounts (outlook.com, hotmail, live) can connect straight away. A work or school account may need its IT admin to approve the app once.

## Possible later improvements

- **Push instead of polling:** Google push channels (`events.watch`) and Microsoft Graph change notifications could replace the 60-second calendar re-read for those two providers, bringing outside edits down to about 10 seconds. This needs a public webhook route that bumps the team change counter, plus a job that renews each subscription before it expires (days). iCloud has no push and would keep polling.
