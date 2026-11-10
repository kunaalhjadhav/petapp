# Phase 1b — Admin dashboard: report

## 1. Implemented

`apps/admin-dashboard` is the Next.js 15 (App Router) staff console on top of the Phase 1 API.

| Screen | What staff can do | Permission |
|---|---|---|
| Sign in | Email and password; a wrong password keeps the email; returns to the page they asked for | staff role |
| Overview | Account and pet counts, 14-day sign-ups, pets by species, latest changes | any staff; each section needs its own permission |
| People | Search by name, phone or email; filter by status and role; paginate | `users.read` |
| Person | Account facts, pets, signed-in devices, change status with a reason, edit roles, **History** | `users.read`, `users.suspend`, `users.roles.assign` + `roles.read` |
| Pets | Search by name or handle; filter by species, status and verification | `pets.read_any` |
| Pet | Profile, owner-only fields for support, vaccinations with expiry, verify, hide or remove with a reason, **History** | `pets.read_any`, `pets.verify`, `pets.moderate` |
| Species & breeds | Add species, show or hide species and breeds, add and rename breeds | `species.manage` |
| Roles & permissions | Matrix of every role against every permission, edit a role, create or delete custom roles | `roles.read`, `roles.manage` |
| Features & settings | Plain-language feature switches labelled by build phase; typed settings | `settings.read`, `flags.manage`, `settings.manage` |
| Audit log | Filter by action, record type and date; before/after detail; links to the record | `audit.read` |
| Search | People and pets in one place | either read permission |

**Design:** a dense, quiet console that keeps the brand's teal for actions. Status colours are used only for status. On every person and pet page, a **History** column shows that record's audit trail beside the actions.

**Responsive:** on phones the menu folds away so content comes first.

## 2. Backend changes

| Change | Why |
|---|---|
| `GET /admin/overview` | Dashboard figures. Each section is returned only if the caller holds its permission. Sign-ins are left out of "latest activity". |
| `verified` filter on `GET /admin/pets` | "Verified" figure and filter |
| **Refresh-token reuse grace window** (`REFRESH_REUSE_GRACE_SECONDS`, default 15) | A dashboard fires parallel requests. Without this, two requests refreshing at once would trip theft detection and sign the admin out. Reuse after the window, or after logout, still revokes the whole session family. |
| **No-op status changes rejected** | Setting a user or pet to the status it already has, or verifying an already-verified pet, now returns 400. Found by the browser tests (see section 6). |

## 3. Security design

- **Server-side API calls (backend-for-frontend):** the browser only ever talks to the Next.js server.
- **Session cookies:** `httpOnly`, `SameSite=Strict`, and `Secure` behind HTTPS. Page scripts can't read tokens.
- **Token refresh:** handled in middleware before the page renders.
- **Server actions:** Next.js checks the request origin. Inputs are validated in the action and again by the API.
- **Open redirects:** only same-site paths are accepted after sign-in. This is covered by a browser test.
- **Security headers:** `X-Frame-Options: DENY`, `nosniff`, `same-origin` referrer policy, HSTS and a restrictive permissions policy. The `X-Powered-By` header is off and search-engine indexing is disabled.
- **Environment label:** always visible in the header, and red when it says Production.

## 4. Files

- `apps/admin-dashboard/src`: 37 files (app routes, components, `lib/` for the API client, session, permissions, formatting and labels).
- `apps/admin-dashboard/e2e`: Playwright suite.
- `infrastructure/Dockerfile.admin`, the `admin` service in `docker-compose.yml`.
- CI job `admin-browser`.
- `docs/screenshots/`.

## 5. Environment variables (dashboard)

| Variable | Purpose |
|---|---|
| `BACKEND_URL` | Where the dashboard's server reaches the API. Never exposed to the browser. |
| `COOKIE_SECURE` | `true` behind HTTPS |
| `NEXT_PUBLIC_ENV_LABEL` | Environment name in the header; set at build time |

The API gains `REFRESH_REUSE_GRACE_SECONDS`.

## 6. Tests and what they caught

| Suite | Result |
|---|---|
| API unit | 48 passed (4 new, for the grace window) |
| API end-to-end, real Postgres + Redis | 28 passed (new: overview scoping, no-op status rejected) |
| Dashboard unit (formatting, token expiry) | 5 passed |
| **Dashboard browser tests (Playwright, Chromium)** | **9 passed, twice in a row on the same data** |

The browser tests cover:

- sign-in redirect and keeping the email after a wrong password;
- open-redirect protection;
- suspending and restoring a person, with the history entry;
- verifying a pet and finding it through the filter;
- toggling a feature and checking it is audited by name;
- adding and hiding a breed;
- search and sign-out;
- the phone layout.

Lint, type check and production build are clean for both apps. The standalone dashboard server was booted and serves its pages and styles.

**Real bugs found and fixed during the browser checks:**

1. **Forms cleared themselves after a failed submit.** React 19 resets a form after its action runs, so a wrong password wiped the email, and a failed status change would wipe a moderator's typed reason. All forms now keep their values on failure.
2. **Stale status choice in the dialog.** After a status change, the next "Suspend or block" dialog opened with the old status preselected. Submitting recorded "Active to Active". The dialog now resets when the status changes, and the API rejects no-op changes.
3. **Several readability fixes:** raw enum values in History ("ACTIVE to SUSPENDED"), raw flag keys in the audit log ("ENABLE_REELS"), the internal module name "Rbac", a clipped roles matrix, sign-in noise in latest activity, and the mobile menu pushing content off-screen.

## 7. Setup

See the README. Run `npm run dev:admin`, then open http://localhost:3000 and sign in with the seeded admin. With Docker, `docker compose up --build` now also serves the dashboard on port 3000.

## 8. Deployment

`infrastructure/Dockerfile.admin` builds a standalone Next.js image (non-root user, healthcheck). In CI, a new `admin-browser` job runs the Playwright suite against a real Postgres, Redis, API and dashboard, and saves the report on failure. The `docker` job now builds and scans both images.

## 9. Known limitations

- **Not run in the sandbox:** the Docker images and GitHub workflows (no Docker daemon there). The `admin-browser` CI job uses the same steps that passed locally.
- **No bulk actions or CSV export yet.** These will come with Phase 2 moderation queues.
- **Name editing:** admins can't edit a person's profile fields. Only status and roles are editable, which matches the API.
- **Audit filtering:** the audit log filters by person or record from links, not by typing a name.

## 10. Next

Phase 2 (Social): storage with signed uploads, posts and reels with the video pipeline, likes, comments, follows, the feed, reporting and blocking, the moderation queue in this dashboard, push notifications, and the Flutter customer app.
