# Security

How PetApp protects accounts, money and data, and the tests that prove it. Report vulnerabilities privately to the security contact published on the website (set one up before launch), not in public issues.

## Controls

| Area | Control | Where tested |
|---|---|---|
| **Sign-in (OTP)** | Codes are hashed with a pepper and expire (5 min). Each code allows a limited number of tries. Codes per number are capped per hour (SMS bombing). Requests are capped per IP; proxy headers are trusted only when `TRUST_PROXY` is set, so `X-Forwarded-For` can't be rotated around the limit. | `security.e2e` (OTP abuse), `app.e2e` |
| **Tokens** | 15-minute access tokens (HS256, issuer and audience checked; `alg: none`, other keys and tampering refused). Refresh tokens are rotated, and reusing an old one revokes the whole chain. Logout, a stolen-token alarm, suspension and deletion end the access token at once (Redis deny-list), not just at expiry. App and admin tokens can't be swapped. | `security.e2e` (token abuse), `token.service.spec`, `app.e2e` |
| **Admin access** | Separate admin login (email and password, bcrypt). Customers can't sign in to the dashboard. Every admin endpoint checks a permission (RBAC); role changes take effect immediately; non-super-admins can't escalate. Financial and administrative actions are in an append-only audit log. | `security.e2e` (staff access), `app.e2e`, `permissions.guard.spec` |
| **Other people's data (IDOR)** | Every query for a person's data is scoped to them; another person's ids answer 404 (not 403, so ids can't be probed). The same holds for partners (bookings) and sellers (products, parcels). | `security.e2e` (IDOR, partners), feature suites |
| **Input** | Every body is validated with whitelisting, and unknown fields are rejected (no mass assignment). Ids must be UUIDs and numbers must be numbers. All SQL is parameterised (Prisma; raw queries use tagged templates). Search wildcards are escaped, so `%` and `_` are searched for literally. | `security.e2e` (SQL injection, mass assignment) |
| **Staff passwords** (Phase 9e) | At least 12 characters; common passwords, repeating patterns, and the person's name or email are refused. Changing needs the current password and signs out every other session. Reset links are emailed only to staff accounts, single-use, valid for 30 minutes, stored only as a SHA-256 hash, and replaced by any newer link; using one signs out everywhere. "Forgot password" answers the same for any address and sends at most 3 links an hour to one address. Admins can send a staff member a link (it goes to the member's email, never to the admin). Every step is audited, and the owner gets an email when the password changes. | `accounts.e2e`, `password.rules.spec` |
| **Staff two-factor** (Phase 10a) | Staff can add an authenticator app (TOTP, 30-second codes, one step of clock drift allowed). The secret is encrypted at rest (`MFA_DATA_KEY`, AES-GCM); a code can't be used twice (the last step used is stored). Signing in becomes two steps: the password gives a 5-minute, 5-try ticket (kept hashed in Redis), then a code or one of ten single-use recovery codes (stored as hashes). Setting it up and turning it off need the password and a code; turning it on signs out other sessions. Using a recovery code emails the owner. Admins can reset a lost authenticator (`users.roles.assign`, never their own). With `security.requireStaffMfa` on, staff without it can only reach the set-up page (403 `MFA_SETUP_REQUIRED`). Every step is audited. | `accounts.e2e`, `totp.rules.spec` |
| **Maps** (final release) | Place search is public but limited to 30 requests a minute per IP, and map answers are cached for a day, so the API can't be used to run up the maps bill. Only the API holds `GOOGLE_MAPS_KEY` (never the apps); positions are rounded to ~100 m before they're sent. A maps outage never stops PetApp's own answers. | `locations.e2e`, `map.provider.spec` |
| **Uploads** | Upload URLs are pre-signed for one key, type and size. Only listed photo, video and document types are accepted (no SVG, HTML or executables). The file's content is checked against its claimed type, and the size must match. Photos are re-encoded and videos transcoded, with location metadata stripped. Originals stay private. Large videos can be sent in parts (resumable): each part's address is signed for its exact length, parts are listed and checked on the server before they're joined, and unfinished uploads are aborted after a day. | `security.e2e` (uploads), `social.e2e`, `accounts.e2e` (resumable) |
| **Payments** | A payment is only marked paid after server-side verification of the gateway's signature (checkout) or a signed webhook, never on the app's word. A signature only fits its own order, so replays from other payments fail. Webhooks are verified, stored by event id, idempotent and retried safely. Amounts are checked. | `security.e2e` (payments), `contests.e2e`, `finance.e2e` |
| **Contest votes** | One vote per entry per day per person, plus a daily allowance. A person's votes in a contest are counted under a database lock, so parallel requests can't exceed it. No self-votes. Phone verification and account age are required. Votes from risky accounts are held for review. | `security.e2e` (votes), `contests.e2e`, `trust.e2e` |
| **Rate limits** | Per-IP limits in Redis (shared across API instances), stricter on sign-in, booking, contest registration and the assistant. | `app.e2e`, `security.e2e` |
| **Secrets** | Nothing secret in the code or the repo. Production refuses test providers (fake payments, console SMS, console email), and bank account numbers are encrypted at rest (`PAYOUT_DATA_KEY`). Use your platform's secret manager, not plain env files. | `env` validation |
| **Transport and headers** | HTTPS at the load balancer. Helmet sets the security headers (HSTS, no sniffing, frame protections). CORS is limited to `CORS_ORIGINS`. The request body limit is 1 MB. | |
| **AI** | User text is fenced so it can't instruct the model. The assistant only reports what PetApp's own data returned. Emergencies and medicine doses get fixed answers. | `assistant.e2e`, `trust.e2e` |

## Chat (Phase 9a)
- **Connecting:** the app swaps its access token for a one-time ticket (valid 60 seconds, usable once) and opens `/api/v1/chat/ws?ticket=…`. Tokens never appear in URLs or logs. The socket is closed when the account stops being active.
- **One way:** the socket only delivers events. Messages are sent over HTTP: validated, rate-limited (`chat.maxMessagesPerMinute`), idempotent by `clientId`, and stored before anyone sees them. The socket accepts only `ping` and `typing`, and typing is only relayed to people in that conversation.
- **Access:** anyone outside a conversation gets 404 for it (ids can't be probed). Cards (bookings, products, orders) must belong to both sides. Photos must be the sender's own private uploads.
- **Abuse:** report and block from the conversation; new conversations per customer per day are limited (`chat.newConversationsPerDay`); text and photos are checked by AI moderation for scams (`chat.aiCheck`). Tested in `chat.e2e`.

## Reviews and reports (Phase 9b)
- **No fake reviews:** a product review needs a parcel with that product delivered to the reviewer; a service review needs their completed booking. One review per person per product (a database constraint), and one per booking.
- **Photos:** review photos must be the reviewer's own finished, public uploads; report screenshots must be the reporter's own private uploads. Anything else is refused.
- **Replies:** only the seller or partner the review is about can reply (anyone else gets 404), once, and not to a hidden review.
- **Ratings can't drift:** averages are recomputed inside the same transaction that adds, hides or restores a review, including when a moderator hides one from a case.
- **Reports:** a business page can be reported while it's public; people can't report their own things or the same thing twice. The reports list shows chat messages by their sender only, never their text. Tested in `reviews.e2e`.

## Search and locations (Phase 9c)
- **Search is read-only and public-only:** every kind filters to what anyone may see (status, visibility, approval, feature flags), excludes blocked people, and escapes `%` and `_` in queries. Queries are capped at 60 characters, and search is rate-limited (60 a minute).
- **No location leaks:** "Pets near you" returns rounded distances only, and only for pets whose owners opted in; partner and city coordinates are business addresses.
- **Imports are checked line by line** (PIN code format, coordinates, duplicates, PIN codes already in another city) and can be dry-run first. Every location change is audited.

## Analytics, memberships and promotions (Phase 9d)
- **Analytics are staff-only and aggregate:** `analytics.read`, admin sessions only. Date ranges are validated and capped at a year; reports are cached for five minutes so they can't be used to load the database. CSV exports protect against spreadsheet formula injection.
- **Memberships are paid only through verified payments:** a membership starts only when the gateway payment is verified (signature or webhook), exactly once; two purchases at once are serialised per person. A payment that can no longer be honoured is refunded through the ledger. Staff grants and early ends need `memberships.manage`, a reason, and are audited.
- **Members-only checks run on the server** (contest entry, challenge join, coupon use, how far ahead slots are offered); the app only shows the labels.
- **Promotions can only open pages inside the app** (`/shop`, `/contest/…`): links to other sites are refused by the API and ignored by the app. Sending is limited to people who opted in, at most once a day each by default.

## Scanning (Phase 8d)

| What | How | When |
|---|---|---|
| **Dependencies** | `npm audit` fails the build on a high or critical advisory in anything that ships (`--omit=dev`), or a critical one anywhere, development tooling included. Dependabot opens grouped update PRs for npm, the Flutter apps, Docker images and GitHub Actions. | Every push, and weekly |
| **Secrets** | gitleaks scans the whole git history (`.gitleaks.toml` allows only test fixtures). | Every push, and weekly |
| **Code** | CodeQL (`security-extended`) for JavaScript and TypeScript. | Every push, and weekly |
| **Images** | Trivy fails the build on fixable critical or high issues in the API, dashboard and website images. | Every push |

**Accepted advisories:** 7 moderate advisories remain, all in NestJS 10's own dependencies. Fixing them needs a NestJS 11 upgrade, a separate project.
- **Status:** none are reachable in how PetApp uses those packages.
- **Review:** look at them again at each dependency review.

**Development tooling:** three high advisories remain in development tooling only.

| Package | Advisory | Why it stays |
|---|---|---|
| `braces` | Deeply nested patterns can exhaust the stack | No fixed release exists yet |
| `glob` 10.4.5 | Command injection through its command-line tool's `-c` option | Pinned exactly by the Nest 10 CLI; PetApp never runs glob's CLI |
| `picomatch` 4.0.1 | ReDoS in some patterns | Pinned exactly by the Nest 10 CLI's schematics |

- **Why the count looks large:** about 30 more high entries in a full `npm audit` are jest, the Nest CLI and micromatch, which only depend on these.
- **Why they're acceptable:** these tools match our own file patterns on developer machines and in CI. They never see user input and aren't in the production images.
- **When they go away:** the NestJS 11 upgrade removes the pins, and Dependabot picks up a `braces` fix when one is released.

**Fixed in 8d:**
- **Upgraded:** Prisma, to 7.10.1.
- **Pinned to fixed versions** (`overrides` in the root `package.json`): multer, body-parser, lodash, js-yaml, postcss, sharp and qs.
- **Development tooling pinned to fixed versions:** handlebars (critical), picomatch (elsewhere in the tree) and tmp.

## Before launch

- A penetration test by an independent firm, on staging with production-like settings.
- Read [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md).
- Rotate every secret that was ever used in development.
- Keep `SWAGGER_ENABLED` off in production, or put the docs behind the admin VPN.
- Turn on MFA for every cloud, GitHub and payment-gateway account that can reach production, and turn on `security.requireStaffMfa` so every dashboard account uses two-factor sign-in.
