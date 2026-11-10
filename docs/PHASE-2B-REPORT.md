# Phase 2b — Notifications and the moderation queue: report

## 1. Implemented

### Notifications (API + worker)

| Event | Who hears | Grouping | Preference |
|---|---|---|---|
| Post liked | Post author | One row per post: "Riya and 4 others liked your post" | likes |
| Comment | Post author | One per comment | comments |
| Reply | Parent comment's author (the post author still gets "commented") | One per reply | comments |
| @mention of a pet (caption or comment) | The pet's owner, **only if they can see the post** | One per pet per post or comment | mentions |
| New follower | The person followed | One row per day | follows |
| Pet followed | The pet's owner | One row per pet per day | follows |
| Post finished processing / failed | Author (not sent when the post published instantly) | One per post | posts / always |
| Content hidden or removed by moderation | Owner | One per item | always |
| Account suspended or restored | The account | Each change | always |

- **Rules:**
  - Nobody is notified about their own actions.
  - Nothing is sent across a block.
  - Recipients must be active.
  - Each person counts once per group, so like, unlike and like again is still one.
  - Retries never duplicate.
  - A notification failure never fails the user's action; events go through the queue.
- **Inbox:** newest first, cursor pages, unread count, mark some or all as read. People can only mark their own notifications.
- **Push:** Firebase Cloud Messaging HTTP v1 with a service account, behind a swappable `PushProvider` (`none`, `console` or `fcm`).
  - Push data carries `type`, `entityType` and `entityId` so the app can open the right screen.
  - Tokens FCM reports as unregistered are deleted.
  - FCM server errors are retried; permission errors are logged.
- **Devices:** a token belongs to one account at a time, so signing in on a shared phone moves it. All tokens are deleted when an account is suspended or deleted, so nothing is pushed to a locked-out phone.

### Moderation queue (admin dashboard)

- **Moderation** appears in the menu for anyone with `content.read`.
- **Queue:** open or resolved cases, filterable by type and sorted by report count. Each row shows a preview (thumbnail, caption or comment, pet, person) and reasons with counts. Welfare and violence reasons are highlighted.
- **Case page:** the reported content in full (even if hidden or removed), the decision form, every report with its details, and the record's history.
  - The options shown depend on the target and the moderator's permissions. "Suspend" appears only with `users.suspend`, and people can't be "hidden".
  - A note is required. The owner is told the outcome, not the note.
- **Overview:** shows a "N report cases waiting for review" banner.

## 2. Migration

`20261002120000_notifications` adds 3 tables and 2 enums, again purely additive. The generator still reproduces every committed migration byte for byte.

## 3. Environment

| Variable | Purpose |
|---|---|
| `PUSH_PROVIDER` | `none`, `console` or `fcm` |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | Firebase service account, required with `fcm`. Startup refuses to proceed if any is missing. |
| `NOTIFY_CONCURRENCY` | Worker setting |

## 4. Endpoints

The API now has 100 operations. The new ones:

- `GET /notifications`
- `GET /notifications/unread-count`
- `POST /notifications/read`
- `GET` and `PUT /notifications/preferences`
- `POST /devices`
- `DELETE /devices/:token`

`GET /admin/overview` now includes `moderation`.

## 5. Tests

| Suite | Result |
|---|---|
| API unit | 61 passed (new: mention parsing, message wording, FCM response handling) |
| API end-to-end | 58 passed in 3 suites (new: **7 notification tests** with the real worker, plus an overview check) |
| Dashboard unit | 5 passed |
| Dashboard browser tests | **10 passed, twice in a row** (new: a moderator reviews and hides a reported pet) |

**The notification tests cover:**

- **Likes:** grouping and counting each person once, ignoring your own like, and the exact push text and data.
- **Comments:** comment, reply and @mention fan-out.
- **Publishing:** the deferred-publish notice; mentions only reaching owners who can see the post.
- **Controls:** preferences (category off, push off), blocks, and daily follow grouping.
- **Other events:** pet followers and moderation outcomes.
- **Inbox:** pagination, marking some or all read, and isolation between users.
- **Devices:** moving between accounts, dead-token pruning, removal on suspension, and the account-status notice.

**Bugs found and fixed:**

1. **Nested links in the moderation queue.** Each row was a link and the author name inside it was another, which is invalid HTML and behaves unpredictably. The browser test caught it.
2. **Case history missed entries.** Moderation decisions are audited under `PET` and pet edits under `Pet`, so filtering by type hid half the history. The trail now matches by record ID alone.

Readiness also proved its worth: when the local S3 test server restarted and lost its bucket, `/ready` reported "bucket does not exist" instead of "ready".

## 6. Setup

- For development, set `PUSH_PROVIDER=console` to see pushes in the worker log.
- For real devices, create a Firebase project, generate a service-account key and set the three `FCM_*` variables.
- Moderators get the new permissions automatically when you run `npm run db:seed` on an existing install.

## 7. Known limitations

- **@mentions are for pets only.** People don't have handles yet. Adding usernames is a small change that would make person mentions possible.
- **No email or SMS fallback** for notifications. In-app and push only.
- **Real FCM delivery wasn't run here**, because Google's endpoints aren't reachable from the sandbox. The provider was tested against FCM's documented response formats, and the end-to-end tests use a capturing provider.
- **Docker and GitHub workflows weren't run here**, because the sandbox has no Docker.

## 8. Next: Phase 2c

The Flutter customer app: sign-in with OTP, pets, feed, reels player, upload, comments, notifications and push registration.

**Important:** the Flutter SDK can't be downloaded in this build environment, so the app will be written to the API contract but **can't be compiled or run here**. Expect a short fix-up pass the first time you run `flutter run`.
