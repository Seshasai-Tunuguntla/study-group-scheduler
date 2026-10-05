# Study Scheduler: project brief and build plan

This file is the source of truth for the project's scope, decisions and progress, so that any
future work session can pick up from the repo alone. Update the **Status** table and the
**Decisions** sections whenever a phase lands.

## How we work

- One phase at a time. Each phase ends with a summary and a pause for review before the next starts.
- Briefly explain each decision. Code quality, tests and clear design decisions matter more than feature count.
- Each approved phase is committed, pushed to `main`, and CI is confirmed green before moving on.
- Commit messages: imperative subject, a body explaining what and why.

## Goal

A web app where a study group finds the best weekly meeting time. Each member marks when they're
free on a weekly grid (like When2meet). The app suggests the best meeting windows: where the most
people can attend, with required members guaranteed.

Portfolio project for entry-level full-stack roles. Its main purpose is to show a genuinely
non-trivial algorithm (scheduling / overlap scoring) inside a clean, tested, deployed full-stack app.

## Stack

Same conventions as the author's previous project (Landlord Maintenance Tracker).

- **Frontend:** React (Vite), react-router, oxlint
- **Backend:** Node.js, Express 5, Prisma 6 (pinned: 7+ needs driver adapters and an ESM-first client), PostgreSQL
- **Validation:** Zod for every request body, query and route param
- **Auth:** bcrypt + JWT (7-day expiry, user id only, HS256 pinned); membership/organizer middleware; ownership checks on every route
- **Security:** helmet, CORS allow-list via `CLIENT_ORIGIN`, rate limiting on login/register and on failed join attempts
- **Tests:** Jest + Supertest against a separate `*_test` database; `tests/unit` needs no database
- **CI:** GitHub Actions: server lint + tests (Postgres 17 service) and client lint + tests (Vitest) + build on every push
- **Deploy (phase 12):** Vercel (frontend, `/api` rewrite to the backend), Neon (Postgres), and the backend as a Vercel Function (chosen over Render; see "Phase 12: deploy")
- **Central error handler:** Zod -> 400, Prisma P2002 -> 409, P2025 -> 404, `HttpError` -> its status
- **Local ports:** API 4100, web 5180 (so it can run next to the Landlord project on 4000/5173)

## Roles

- **Organizer:** creates the group, gets the join code, marks members required/optional, confirms the meeting time, can remove members. Can't leave their own group (409), including via removing themselves.
- **Member:** joins via code, sets their own availability, sees suggestions and the confirmed session, can leave.
- A user can be in many groups with a different role in each: the role lives on `Membership`, not `User`.

## Core features

1. Register / login
2. Create a group (creator becomes organizer); join a group by 8-character join code
3. Weekly availability grid: drag to select free 30-minute slots, per group
4. Group heatmap: for each slot, how many members are free, and who
5. "Suggest times": choose a duration, get the top 3 non-overlapping windows, each showing who can and can't attend
6. Organizer confirms one window (or any valid time) as the group's weekly session
7. Dashboard: my groups, my confirmed sessions shown in my local time zone
8. Public self-resetting demo: demo organizer + demo member accounts, a seeded group with varied availability, reset on server start and when a demo account logs in 30+ minutes after the last reset; demo accounts can't join other groups and nobody can join the demo group

## Time model

- The week is circular: 7 days x 48 slots = **336 slots** of 30 minutes.
- Slot 0 = Monday 00:00 UTC. All stored times are **UTC minutes-of-week** (0-10079).
- Each user stores an IANA time zone (e.g. `Asia/Kolkata`), captured at signup from the browser and stored exactly as sent. UTC offsets like `+05:30` are rejected.
- The client converts the user's local grid selections to UTC before saving, and converts back for display.
- Windows may wrap from Sunday night into Monday morning.
- Stored availability ranges never wrap: a Sunday-night-into-Monday block is two rows. `endMinute` is exclusive and may be 10080.
- **Known trade-off (README):** availability is a recurring weekly pattern in UTC, so for users in DST regions the local time shifts by an hour when DST changes.
- **Zones with 45-minute offsets** (e.g. `Asia/Kathmandu`, +05:45) don't line up with 30-minute UTC slots. The grid must be built from UTC slots and only *labelled* in local time (rows like 09:15, 09:45), so any offset works.

## The scheduling algorithm (`server/src/scheduling/suggestWindows.js`)

A pure function with no database or Express, fully unit tested.

- **Input:** `members: [{ id, required, freeSlots }]`, `durationMinutes` (multiple of 30, 30-240), `limit` (default 3), `minAttendees` (default 2), `preferredSlots` (UTC slot indexes).
- **Process:** for every start slot (0-335, wrapping), a member can attend only if free for every slot of the window. Drop windows missing a required member or with fewer than `minAttendees`. Rank by attendees (desc), then preferred-window overlap (desc), then earliest start (asc). Pick greedily, skipping any window that overlaps an already-picked one, including across the week boundary.
- **Output:** `[{ startMinuteOfWeek, endMinuteOfWeek, attendees, missing, preferredMinutes }]`
- **Performance:** O(slots x members) using per-member prefix sums over the week laid out twice (explained in the file's header comment).
- **Tests:** all required cases, plus a brute-force reference implementation compared on 300 seeded random groups.

## Data model (Prisma)

- **User:** id, name, email (unique, trimmed + lowercased), password (bcrypt hash, omitted from every query by default), timeZone, createdAt
- **Group:** id, name, joinCode (unique), createdAt, createdById (for the record only; permissions come from Membership)
- **Membership:** id, userId, groupId, role (`ORGANIZER` | `MEMBER`), required (default true), joinedAt, **availabilityUpdatedAt** (null = never saved); unique on (userId, groupId)
- **AvailabilityRange:** id, membershipId, startMinute, endMinute (UTC, end exclusive, multiples of 30, never wrapping); cascades with the membership
- **Session:** id, groupId (unique: one per group), startMinute, durationMinutes, confirmedById, confirmedAt
- CHECK constraints in the init migration enforce the time rules in the database too.

## API reference

All routes are under `/api`. Group routes require a token. A non-member gets **404 Group not found**,
the same as for a missing group, so sequential ids reveal nothing. A plain member calling an
organizer-only route gets **403**. Errors are always `{ error, details? }`.

### Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password, timeZone }` | 201 `{ token, user }` |
| POST | `/auth/login` | `{ email, password }` | 200 `{ token, user }`; 401 for a wrong email or password (same message). A demo login may first reset the demo (see phase 10) |
| GET | `/auth/me` | | `{ user }`; 401 if the token is bad or the user is gone |
| PATCH | `/auth/me` | `{ timeZone, keepLocalTimes? }` | `{ user, shiftedByMinutes }`. Only the zone can change. By default stored availability (UTC) doesn't move. With `keepLocalTimes: true` it's shifted to keep the same local clock times |

`user` = `{ id, name, email, timeZone, createdAt }`

### Groups
| Method | Path | Who | Response |
|---|---|---|---|
| POST | `/groups` `{ name }` | anyone | 201 `{ group }` (caller is organizer) |
| GET | `/groups` | anyone | `{ groups: [{ id, name, myRole, required, availabilityUpdatedAt, memberCount, joinCode, session, heat }] }` |
| GET | `/groups/:id` | member | `{ group: { id, name, createdAt, joinCode, myRole, members, session } }` |
| POST | `/groups/join` `{ joinCode }` | anyone | 201 `{ group }`; 404 unknown code; 409 already a member; 403 for a demo account, or a code of a group a demo account created |
| PATCH | `/groups/:id/members/:userId` `{ required }` | organizer | `{ member }` |
| DELETE | `/groups/:id/members/:userId` | organizer, or self to leave | 204; 409 if the organizer targets themselves |

- `joinCode` is `null` for everyone except the organizer (a deliberate choice; note it in the README).
- `member` = `{ userId, name, role, required, joinedAt, availabilityUpdatedAt }`: names and roles only, never emails or time zones.
- `session` (summary) = `{ startMinute, durationMinutes, confirmedAt }` or `null`.
- `heat` = `{ respondedCount, freeCounts }`: `freeCounts[i]` is how many members who have saved their week are free in UTC slot i (336 numbers). Counts only, for the dashboard's mini heatmap.

### Availability
| Method | Path | Body | Response |
|---|---|---|---|
| PUT | `/groups/:id/availability` | `{ ranges: [{ startMinute, endMinute }] }` (max 336; end <= start means it wraps) | `{ ranges, availabilityUpdatedAt }` (stored form: split, sorted, merged) |
| GET | `/groups/:id/availability` | | `{ members, slots, myRanges }` |

- PUT replaces the caller's own ranges atomically. Saving `[]` still sets `availabilityUpdatedAt`.
- Overlapping ranges -> 400 naming both.
- `slots` has 336 entries: `slots[i]` = user ids free in UTC slot i.

### Suggestions and session
`GET /groups/:id/suggestions?duration=60&limit=3&minAttendees=2&preferredStart=16:00&preferredEnd=21:00`

```json
{
  "suggestions": [{ "startMinute": 540, "endMinute": 600, "durationMinutes": 60,
                    "attendees": [{ "userId": 1, "name": "Ana", "required": true }],
                    "missing": [], "preferredMinutes": 60 }],
  "reason": null,
  "waitingOn": [{ "userId": 3, "name": "Ben", "required": true }],
  "mayChange": true,
  "durationMinutes": 60,
  "preferredWindow": { "start": "16:00", "end": "21:00", "timeZone": "Asia/Kolkata" }
}
```

- **`reason`** when `suggestions` is empty:
  - `not_enough_members` -> UI shows "Invite members" (with the join code for the organizer)
  - `waiting_for_responses` -> UI shows "Waiting on: <names>"
  - `no_common_time` -> UI explains nobody overlaps and suggests a shorter duration or marking someone optional
- Members who **never saved** are excluded from scheduling and the required check, and listed in `waitingOn`. **Saved empty** members follow the normal rules.
- The preferred window is in the **requesting user's** time zone, applies to the same hours every day, and may cross midnight (`21:00`-`01:00`).

| Method | Path | Who | Response |
|---|---|---|---|
| GET | `/groups/:id/session` | member | `{ session }` or `{ session: null }` |
| POST | `/groups/:id/session` `{ startMinute, durationMinutes }` | organizer | `{ session }`; any valid time, replaces any earlier one |
| DELETE | `/groups/:id/session` | organizer | 204; 404 if none |

`session` = `{ startMinute, endMinute, durationMinutes, confirmedAt, confirmedBy: { userId, name }, attendance: { attendees, missing, waitingOn } }`.
Attendance is recalculated from current availability on every request.

## Frontend pages

- `/login`, `/register`, with one-click "Try as organizer" / "Try as member" demo buttons (as in the Landlord project)
- `/dashboard`: my groups, my confirmed sessions in local time, create/join group
- `/groups/:id`: tabs for **My availability** (drag-select grid), **Group heatmap**, **Suggestions** (duration picker, top 3 cards with attendees/missing, organizer "Confirm"), **Members** (organizer can toggle required / remove)
- The grid supports mouse drag to select and deselect, and works on mobile (tap to toggle is fine)
- Loading, empty and error states everywhere; clean minimal design reusing the Landlord project's look; works on mobile
- All times shown in the user's local time zone
- Handle every suggestions `reason` (see above); a group with only the organizer shows "Invite members", not a blank result

## Build order and status

| # | Phase | Status |
|---|---|---|
| 1 | Scaffold repo: client and server, Prisma, Jest, oxlint, CI | Done |
| 2 | Scheduling algorithm as a pure module + all unit tests | Done |
| 3 | Prisma schema + migrations, auth routes (register/login/me) + tests | Done |
| 4 | Groups, memberships, join codes, role/ownership checks + tests | Done |
| 5 | Availability API with validation and range merging + tests | Done |
| 6 | Suggestions endpoint + session confirm/get/delete + tests | Done |
| 7 | Frontend: auth pages, dashboard, group page (+ Members and Suggestions tabs, session card) | Done |
| 8 | Availability grid with drag-select and time zone conversion (+ change saved time zone) | Done |
| — | Visual redesign: "Focus" (see Design below) | Done |
| 9 | Heatmap UI, preferred-hours control on Suggestions | Done |
| 10 | Self-resetting demo data + tests | Done |
| 11 | README for recruiters: screenshots, architecture diagram, design decisions, known trade-offs, how to run and test; dashboard mini heatmap; Playwright smoke test; light theme | Built, in review |
| 12 | Deployment config | |

## Frontend decisions (phase 7)

- **Which time zone:** times are shown in the zone saved on the account (`user.timeZone`), the same zone the server reads preferred hours in, so display and scheduling always agree. `TimeZoneNote` says which zone is in use. It warns when the device's zone has a different offset (comparing offsets, since browsers may report `Asia/Calcutta` for `Asia/Kolkata`).
- **Time code:** UTC <-> local conversion and formatting live in `client/src/time/week.js` (unit tested with Vitest), and formatting follows the browser locale (12h/24h).
- **Routing:** group tabs are nested routes (`/groups/:id/availability|heatmap|suggestions|members`), so each tab has its own URL.
- **Loading data:** every screen loads through `useLoad(load, key)`, which handles the loading, error (with retry) and loaded states and ignores out-of-date responses.
- **Signing out:** any 401 on a signed-in request logs out. At startup, only a 401 clears the saved token; if the server is unreachable, the app shows "Can't reach the server" with Try again instead of logging the user out.
- **Suggestions tab (built in phase 7):** handles every `reason`, the `mayChange` banner, and organizer Confirm. Session attendance is shown on the group page. Waiting lists say "you" for the viewer.
- **Look:** replaced by the Focus design (below). Phase 7 had reused the Landlord project's look.

## Design: "Focus"

Chosen from three mockups (Planner, Focus, Bright), each built at desktop and 375 px with sample data.

- **Why Focus:**
  - The project's centrepiece is the scheduling algorithm, and Focus makes its output, the week heatmap, the hero.
  - It is also the clearest break from the Landlord project: dark rather than light, a compact top bar rather than a page header, and rows rather than cards. On a resume the two read as different products.
- **Identity:**
  - Dark slate surfaces, one lamp-amber accent (`#ffb547`), Red Hat Display for headings and Red Hat Text for body.
  - The brand mark is two offset squares, a lit grid cell over a dimmer one.
  - No hazard tape, key tags or all-caps labels.
- **Tokens:** every colour, font and radius is a CSS variable in `:root` in `client/src/index.css`, and component styles use only tokens (no raw colours below the token block). There are semantic tokens for surfaces, text, the accent, the heat scale and status colours. The light theme (phase 11) gives each colour token a second value through `light-dark()`.
- **Accessibility:**
  - Text is 10.9-13.6:1, muted text 5.8:1 or more, and amber on surfaces 7.4:1 or more.
  - Input borders reach 3:1 or more (their own token), and free grid cells are 8.8:1 against empty ones.
  - The heat scale is a brightness ramp, and the heatmap prints counts, so colour is never the only cue.
- **Layout:**
  - A sticky 52 px top bar.
  - The dashboard has a "Next session" bar and one row per group.
  - The group page shows "3 of 4 replied. Waiting on Cal.", a session card with an amber edge, tabs as one segmented control, and suggestions as side-by-side cards.
  - The login page reads: what the app does, the demo buttons, the form, then a glimpse of the heatmap. Wide screens put the form beside the rest.
- **Left for later**, because each needs new behaviour or data, not just styling: a mini week heatmap per group on the dashboard (built in phase 11) and a group switcher in the top bar (optional).

## Availability grid decisions (phase 8)

- **Grid logic:** pure functions in `client/src/availability/grid.js`, tested with Vitest.
  - The selection is a Set of **UTC slots**; `buildWeekGrid(timeZone)` only decides where each slot is drawn (local day column, local time row).
  - Every slot maps to exactly one cell in every zone. Rows are labelled :15/:45 in +05:45 zones, and local Monday 00:00 can be UTC Sunday.
- **Pointer events** handle mouse, pen and touch in one code path (`AvailabilityGrid.jsx`).
  - The first cell pressed decides add or remove (`dragMode`), and a drag paints the rectangle between the first and current cell.
  - **Touch:** the page scrolls normally (`touch-action: manipulation`), and a tap toggles a cell (a finger that moved over 10px was scrolling). A "Drag to select" switch, shown on touch screens only, sets `touch-action: none` so a finger paints like a mouse.
  - **Keyboard:** arrows move between cells; Space/Enter toggles.
- **Saving:**
  - An explicit Save, with "Not saved yet" / "Saved" / "Last saved …" and Discard.
  - Leaving with unsaved changes asks first: `useBlocker` for in-app navigation (this needed the switch to a data router, `src/router.jsx`), `beforeunload` for reloading or closing the tab.
  - "Copy Monday to weekdays" and "Clear" edit the draft only, until Save.
- **Changing the saved time zone:** `PATCH /auth/me { timeZone, keepLocalTimes }`, offered by the "Use this device's time zone" button in the mismatch notice, which asks what should happen to saved availability.
  - **Keep the same moments (default):** ranges stay at the same UTC moments and are just re-labelled, so the rest of the group sees no change.
  - **Keep my local hours:** every saved schedule is shifted in one transaction so 18:00 stays 18:00 locally. Ranges live on 30-minute UTC slots, so the shift is rounded to the nearest half hour.
    - Exact ties (zones 15 or 45 minutes apart, such as India <-> Nepal or UTC <-> Nepal) **round toward zero**: the smaller move.
    - Because the rule is symmetric, switching A -> B -> A always restores the original ranges, and local times stay within 15 minutes. `Math.round` would not: it rounds +0.5 up but -0.5 to 0, so India -> Nepal moved 0 while Nepal -> India moved +30.
  - The response's `shiftedByMinutes` bumps `availabilityVersion` on the client, so the grid, suggestions and attendance reload. Unsaved grid edits are confirmed before they're dropped.
- **Logging out** goes through a `/logout` route, so the grid's leave warning covers it too.

## Heatmap and preferred hours decisions (phase 9)

- **Heatmap layout:** `HeatGrid.jsx` draws one cell per UTC slot, laid out and labelled in the viewer's zone, like the availability grid.
  - At 900 px and up it runs sideways (days down, 48 half hours across): the Focus hero, the whole week at a glance.
  - Narrower screens get the upright layout (days across). `useMediaQuery` picks the layout.
- **Not colour alone:** every cell prints its free count, and the steps (`heatLevel`) get brighter monotonically, ending at "everyone who replied". The scale is one amber hue, dim to bright, so it reads without telling hues apart (colour-blind friendly). The legend lists which counts each step means (`legendSteps`).
- **Who is counted:** counts are out of the members who have saved their week ("Counts are out of the 3 members who have filled in their week"). Never-saved members are listed as "Not counted yet" or "Hasn't replied" and never lower a count.
- **Who is free:** the line under the grid answers mouse hover, tap, click and keyboard focus with "Wednesday 18:30 – 19:00: 3 of 3 free. Free: …, Not free: …, Hasn't replied: …". Names only. The latest interaction wins.
  - The line is sticky at the bottom of the screen, so on a phone the answer is visible wherever the tapped cell is.
  - Every cell also has a full `aria-label`, and the arrow keys move in the direction the grid is laid out.
- **Marks:** the confirmed session is outlined, and the best times show their rank (1-3) on their first half hour. The best times come from the same settings as the Suggestions tab.
- **Preferred hours:** "From" and "Until" selects in the account's zone, the same hours every day. An end at or before the start crosses midnight and gets a "past midnight" chip. Moving one end onto the other pushes the other end an hour, so the window can't become empty. Best times inside the hours are labelled "Inside your preferred hours".
- **Remembered per user and group in this browser (localStorage), not on the server:** session length and preferred hours are a personal view setting for exploring best times; other members never see them, and they change no shared data. The trade-off is that they don't follow you to another device. Reads and writes are wrapped so blocked storage just means "not remembered", and stored values are validated before use (`client/src/suggestions/settings.js`).
- **Why a bright half hour isn't a best time:** the "who's free" line adds "Not suggested: Ben is required." when a required member who replied isn't free (added in phase 10, where the demo makes this case visible).

## Demo decisions (phase 10)

- **One click:** "Try as organizer" (Priya, Asia/Kolkata) and "Try as member" (Sam, Europe/London) on the login and register pages log in with a public password (`password123`) and open the dashboard.
- **The data shows the app's strengths** (`server/src/demo/demo.js`):
  - "Algorithms study group" has 6 members in India, London and New York, so the two demo accounts see the same session at different local times.
  - Cal (required) never saved, so "Waiting on Cal", "Not counted yet" and "may change" appear.
  - Ben (required, New York) isn't free on Thursday, when 4 of 5 are. The best times are 3-person slots that include him; making him optional on the Members tab brings Thursday to the top.
  - The top suggestion, Tuesday 13:30 UTC (19:00 in India), is already the confirmed weekly session, so the dashboard isn't empty.
  - "Physics lab group", where only Priya has replied, shows the "waiting for responses" state and Sam's "Fill in your week" nudge.
  - The other members' passwords are random and never kept, so only the two demo accounts can log in.
- **Reset:** `resetDemoData` rebuilds everything in one transaction, keeping the rows that pages and tokens point at:
  - The demo users are upserted: name, time zone and password restored, ids kept, so a logged-in visitor stays logged in.
  - Groups visitors created are deleted.
  - The fixture groups are found by `Group.demoKey` (null on every real group) and keep their ids and join codes. Only their contents are rebuilt: memberships (restoring removed members and required flags), availability and the session. A visitor looking at a demo group during a reset sees fresh data, not "Group not found".
  - It runs when the server starts, and on a successful demo login when the last reset is 30+ minutes old, so two visitors exploring at the same time don't wipe each other's work. `npm run demo:reset` runs it by hand.
  - A failed reset at start is logged and the API still serves real users.
  - Overlapping resets in one process share one rebuild, and a Postgres advisory lock makes resets in different processes run one after another.
- **A closed world:** demo accounts can't join any group (403), and nobody can join a group a demo account created (403). So a reset can never touch a real user's data, and a visitor can't use the demo to reach real groups.
- **Tests** (`server/tests/api/demo.test.js`) cover the data's story, the reset on start (and a failed one), the 30-minute window both ways, that a wrong password or a real login never resets, every kind of visitor change being restored, user and group ids surviving a reset, concurrent resets, real users' data being untouched, and both join blocks. Each protection was also broken on purpose to check a test fails.

## Phase 11 decisions

### Dashboard mini heatmap
- **API:** `GET /groups` returns `heat: { respondedCount, freeCounts }` per group: 336 counts of members free in each UTC slot, counting only members who have saved (`heatSummary` in `server/src/services/memberAvailability.js`, next to `splitByResponse`). Every group's ranges come from one extra query, not one per group. Counts only, no names or ids.
- **Client:** `MiniHeat.jsx` draws a row per day and a cell per half hour in the viewer's zone, with the group heatmap's `heatLevel` steps. The grid is too small to read counts from, so it is hidden from screen readers. Its caption carries the meaning in words: "Most free: Thu 19:30 – 22:00 (4 of 5)".
- **The caption** is the longest unbroken stretch at the top count, with ties going to the earliest on the viewer's own calendar (`mostFreeStretch`, Vitest). It follows stretches from Sunday night into Monday, and says "free all week" or "no free time marked yet" when that's the case.
- **Layout:** a fourth column in the group row on wide screens, and stacked on phones.

### End-to-end smoke test (Playwright)
- **The test** (`e2e/tests/demo.spec.js`): "Try as organizer" -> the dashboard (session time and mini heatmap caption) -> the group ("5 of 6 replied") -> Suggestions (3 picks, the top one is the weekly session, "Still waiting on Cal"). It asserts on roles and visible text, not CSS classes.
- **Setup** (`e2e/playwright.config.js`):
  - It runs the **production build** of the client (`vite preview`, which proxies `/api` like the dev server) and the real API.
  - It uses its own ports (4200, 5280) and its own database (`study_scheduler_e2e`, refused unless the name ends in `_e2e`), so it can run beside the dev servers. The API's demo reset on start seeds it, so there's no extra seed step.
  - The browser is the installed Google Chrome (`channel: 'chrome'`), which GitHub's Ubuntu runners also have, so no browser download is needed.
  - The time zone is `Asia/Kolkata` and the locale `en-GB`, so the asserted times are fixed: India has no daylight saving time.
- **CI:** a third job with its own Postgres service. It keeps the Playwright report and trace as an artifact when the test fails.

### Light theme
- **One token block:** every colour token is `light-dark(<light>, <dark>)`. The page follows the system setting (`color-scheme: light dark`), and the top-bar button pins one theme with `data-theme` on `<html>`, which sets `color-scheme`. No component CSS changed. The dark values are exactly the Focus values.
- **Palette:** a cool grey page with white panels (not cream). On white, the lamp amber is deepened (`#a35500`) so links and buttons with white text pass AA. The heat scale goes from pale to deep amber, so more people free is darker. It still changes steadily in brightness, readable without telling hues apart.
- **Contrast is checked by a script**, not by eye: `client/scripts/checkContrast.mjs` reads the token pairs from `index.css` and checks the 29 colour pairs the components use, in both themes (58 checks). It runs in CI as `npm run contrast`.
- **The button** is named for what it does ("Switch to light theme"). Switching to the system's own theme removes the pin, so the page follows the system again. The pin is stored in `localStorage`, and a small script in `index.html` applies it before the first paint, so the page never flashes the other theme. The two `theme-color` metas follow the theme too (`client/src/theme/theme.js`, Vitest).

### README
- It covers the demo's story, the features, the time model and the algorithm, a Mermaid architecture diagram, the design decisions, testing, known trade-offs and how to run it.
- **Screenshots** in `docs/screenshots/` come from the real app with the demo data (desktop at 1280 px, phones at 375 px), at India time.
- **Times in the README:** never write a fixed local time for London or New York (e.g. "14:30"): it moves with daylight saving. Give the UTC time, India's time (no DST), or say "the same moment in each member's zone".

### Bugs found and fixed along the way
- **Logging out by loading `/logout` directly could sign the user back in (development only).** React runs effects twice in development, so two "is the saved login still valid?" checks were in flight, and the later one set the user again after the logout. The startup effect now ignores a check that finishes after it was cleaned up. Production runs the effect once, so this only showed in development, but the fix is the correct pattern.
- **On the wide (sideways) heatmap the best-time badges covered the counts**, because the cells are too narrow for both side by side. Marked cells now stack them: the badge top-left, the count bottom-right.

## Notes for later phases

### Optional polish
- **Group switcher** in the top bar.

### Phase 12: deploy
- **Hosting decision (checked October 2026): run the API as a Vercel Function, not on Render.**
  - **Why not Render:** Render gives 750 free instance hours per workspace per month and suspends every free service in the workspace when they run out. The Landlord API's keep-awake ping already keeps one service up around the clock (about 720-744 hours a month), so a second free service would run out mid-month. Without a ping, a free Render service sleeps after 15 minutes idle and takes about a minute to wake, which is what the demo buttons' "wake up" note was written for.
  - **Why Vercel:** Vercel deploys an Express app with zero configuration as a single Vercel Function (Fluid compute). The client is going to Vercel anyway. The Hobby plan includes 1,000,000 function invocations, 4 active CPU-hours and 360 GB-hours of provisioned memory a month, far more than a portfolio app uses, with no card and no keep-awake ping. Cold starts take well under a second, not a minute. Hobby is for personal, non-commercial use, which fits a portfolio. The database stays on Neon.
  - **Alternatives checked:**
    - Google Cloud Run: always-free tier of 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests a month, and it scales to zero. It needs a billing account with a card, and a container build. This is the fallback if Vercel doesn't work out.
    - Railway: $5 trial credit, then $1 of credit a month. Too little for an always-available API.
    - Fly.io: no free tier for new accounts.
    - Koyeb: closed its free plan to new users in 2026.
  - **What changes for serverless, to do in phase 12:**
    - **Demo reset:** "on server start" would mean "on every new function instance", which can wipe a visitor's changes mid-visit. Store the last reset time in the database and reset on start or on demo login only when it is 30+ minutes old. The advisory lock already orders resets from several instances.
    - **Rate limits:** the in-memory store is per instance, so limits get weaker as instances come and go. Move to a Postgres-backed store, or accept it and document it. Decide together with the `req.ip` check below.
    - **Shape:** two Vercel projects (client from `client/`, API from `server/`) with a rewrite of `/api/*` from the client to the API, so the browser stays same-origin. Point the entry at `src/app.js` (it exports the app), and run startup work (env check, demo reset) without `app.listen`.
    - **Prisma:** use Neon's pooled connection string for the app and the direct one (`directUrl`) for `prisma migrate deploy` at build time.
- After deploying, test the availability grid on a real phone (iOS Safari and Android Chrome): tap to toggle, scrolling over the grid, "Drag to select", the leave warning, and the sticky Save bar. Emulated touch in desktop browsers isn't the same as a real finger.
- Requests go browser -> Vercel rewrite -> the API (on Vercel now, rather than Render). With `trust proxy = 1`, `req.ip` may be a Vercel edge IP for everyone, putting all users in one bucket for **both** the auth limiter and the join-code limiter.
- Log `req.ip` in production, then fix `trust proxy` or the limiters' key function so both use the real client IP, and add a test for the key function.
- The `TODO(deploy)` comment is in `server/src/app.js`.
