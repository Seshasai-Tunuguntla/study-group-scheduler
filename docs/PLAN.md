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
- **Deploy (phase 12):** Vercel (frontend, `/api` rewrite to the backend), Neon (Postgres), Render (backend)
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
| POST | `/auth/login` | `{ email, password }` | 200 `{ token, user }`; 401 for a wrong email or password (same message) |
| GET | `/auth/me` | | `{ user }`; 401 if the token is bad or the user is gone |

`user` = `{ id, name, email, timeZone, createdAt }`

### Groups
| Method | Path | Who | Response |
|---|---|---|---|
| POST | `/groups` `{ name }` | anyone | 201 `{ group }` (caller is organizer) |
| GET | `/groups` | anyone | `{ groups: [{ id, name, myRole, required, availabilityUpdatedAt, memberCount, joinCode, session }] }` |
| GET | `/groups/:id` | member | `{ group: { id, name, createdAt, joinCode, myRole, members, session } }` |
| POST | `/groups/join` `{ joinCode }` | anyone | 201 `{ group }`; 404 unknown code; 409 already a member |
| PATCH | `/groups/:id/members/:userId` `{ required }` | organizer | `{ member }` |
| DELETE | `/groups/:id/members/:userId` | organizer, or self to leave | 204; 409 if the organizer targets themselves |

- `joinCode` is `null` for everyone except the organizer (a deliberate choice; note it in the README).
- `member` = `{ userId, name, role, required, joinedAt, availabilityUpdatedAt }`: names and roles only, never emails or time zones.
- `session` (summary) = `{ startMinute, durationMinutes, confirmedAt }` or `null`.

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

- `/login`, `/register`, with one-click "Try the demo" buttons (as in the Landlord project)
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
| 7 | Frontend: auth pages, dashboard, group page (+ Members and Suggestions tabs, session card) | Built, in review |
| 8 | Availability grid with drag-select and time zone conversion | |
| 9 | Heatmap UI, preferred-hours control on Suggestions | |
| 10 | Self-resetting demo data + tests | |
| 11 | README for recruiters: screenshots, architecture diagram, design decisions, known trade-offs, how to run and test | |
| 12 | Deployment config | |

## Frontend decisions (phase 7)

- **Which time zone:** times are shown in the zone saved on the account (`user.timeZone`), the same zone the server reads preferred hours in, so display and scheduling always agree. `TimeZoneNote` says which zone is in use. It warns when the device's zone has a different offset (comparing offsets, since browsers may report `Asia/Calcutta` for `Asia/Kolkata`).
- **Time code:** UTC <-> local conversion and formatting live in `client/src/time/week.js` (unit tested with Vitest), and formatting follows the browser locale (12h/24h).
- **Routing:** group tabs are nested routes (`/groups/:id/availability|heatmap|suggestions|members`), so each tab has its own URL.
- **Loading data:** every screen loads through `useLoad(load, key)`, which handles the loading, error (with retry) and loaded states and ignores out-of-date responses.
- **Signing out:** any 401 on a signed-in request logs out. At startup, only a 401 clears the saved token; if the server is unreachable, the app shows "Can't reach the server" with Try again instead of logging the user out.
- **Suggestions tab (built in phase 7):** handles every `reason`, the `mayChange` banner, and organizer Confirm. Session attendance is shown on the group page. Waiting lists say "you" for the viewer.
- **Look:** the Landlord project's palette, fonts (Barlow / Barlow Condensed) and building blocks; the header's hazard tape became a strip of half-hour slots.

## Notes for later phases

### Phase 8: availability grid
- Replace the placeholder in `client/src/pages/group/AvailabilityTab.jsx`.
- Build rows from UTC slots and label them in the account's zone (handles +05:45 zones).
- Selected local slots -> UTC ranges for `PUT /availability` (the server splits wrap-arounds and merges).
- Show the "never saved" vs "saved empty" difference, and make an explicit Save with unsaved-changes feedback.

### Phase 9: heatmap and preferred hours
- Replace `HeatmapTab.jsx`.
- Add `preferredStart`/`preferredEnd` controls to the Suggestions tab.

### Phase 10: demo
- Demo accounts can't join other groups, and nobody can join the demo group. Same pattern as the Landlord project.
- Add the one-click "Try the demo" buttons to `client/src/components/AuthLayout.jsx` (left out in phase 7 because the accounts didn't exist yet).

### Phase 11: README
- **Design decisions:** prefix sums; non-member 404; organizer-only join code (deliberate); "never saved" vs "saved empty"; update-first transaction ordering (a test caught the race); CHECK constraints in the init migration; password hashes omitted by default.
- **Known trade-offs:**
  - DST shift of the UTC weekly pattern
  - the rate limiter's in-memory store (resets on restart, single instance only)
  - `npm audit` reports a high in the Prisma CLI's `deepmerge-ts`: not reachable at runtime, and the suggested fix downgrades Prisma
  - JWT in localStorage

### Phase 12: deploy
- Requests go browser -> Vercel rewrite -> Render. With `trust proxy = 1`, `req.ip` may be Vercel's edge IP for everyone, putting all users in one bucket for **both** the auth limiter and the join-code limiter.
- Log `req.ip` in production, then fix `trust proxy` or the limiters' key function so both use the real client IP, and add a test for the key function.
- The `TODO(deploy)` comment is in `server/src/app.js`.
