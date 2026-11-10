# Phase 2a — Social core: report

## 1. Implemented

| Area | What it does |
|---|---|
| **Media storage** | An S3-compatible provider (AWS S3, Cloudflare R2, MinIO). The app gets a signed URL and uploads straight to storage, with the file type and exact size locked into the signature. The API confirms the upload with a HEAD check. Originals stay private; only processed copies are ever served, through a CDN or 1-hour signed URLs. `S3_PUBLIC_ENDPOINT` handles setups where the app and the API reach storage at different addresses, such as Docker. |
| **Media worker** | A BullMQ worker, built from the same image as the API with a different command. **Photos:** checks the real format, applies phone rotation, makes 1080/640/320 WebP versions and **strips all metadata, including GPS**. **Videos:** probes the real content, checks the length limit, makes two HLS qualities (720p and 360p, measured on the short side so portrait reels work), adds a poster image and **strips location tags**. Broken files are rejected immediately; network or storage errors are retried 3 times with backoff. |
| **Posts and reels** | Photo posts (up to 10 images, configurable), video posts and reels, with a caption, hashtags (including Indian scripts), pet tags, location, and public or followers-only visibility. A post waits in PROCESSING until its media are ready, then publishes itself. Authors can edit and delete. |
| **Engagement** | Likes and saves (repeat taps don't double-count), shares by channel, views counted once per viewer per day, and a saved-posts list. |
| **Comments** | One level of replies (a reply to a reply joins the thread), counts kept accurate, and deletion by the comment's author or the post's author. |
| **Feeds** | Home feed (you and people you follow, newest first, cursor pages with no repeats or gaps), trending and the Reels tab (ranked by a score recomputed every 10 minutes), hashtag pages, trending hashtags, and posts by a user or a pet. |
| **Blocking** | Hides two people from each other everywhere (posts, profiles, pets, comments, feeds) and removes follows of people and their pets in both directions. |
| **Reports** | Users can report people, pets, posts and comments. They can't report themselves, and each person can report the same thing only once. Reports on the same thing are grouped into one open case. An optional auto-hide threshold hides content while it waits for review, and never removes it. |
| **Moderation API** | Lists cases with reason breakdowns and previews of hidden or removed content; resolves a case by dismissing it (which restores auto-hidden content), hiding or removing the content, or suspending the account (which also needs the `users.suspend` permission). Every decision is audited. |
| **Feature flag** | All social endpoints answer 404 until `ENABLE_REELS` is on. |

## 2. Upgrade-safe permissions

New permissions are `content.read` (Moderator, Support agent) and `content.moderate` (Moderator).

Phase 1's role sync only applied default permissions to newly created roles, so an existing install would never have given Moderators these. The sync now also grants each new permission to the roles whose defaults include it, without overwriting permissions an admin edited in the dashboard. A test simulates an existing Phase 1 database to prove this.

## 3. Migration

`20261002090000_social` adds 13 tables, 11 enums, 22 foreign keys and their indexes, and changes nothing that already exists. It was generated with the same tool as Phase 1; that tool reproduces the Phase 1 migration byte for byte, and the new file is the exact difference between the two schemas. It has been applied to the dev and test databases. `npm run db:check-drift` in CI confirms it matches `schema.prisma`.

## 4. New environment variables

- **Storage:** `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `MEDIA_PUBLIC_BASE_URL`, `UPLOAD_URL_TTL_SECONDS`.
- **Worker:** `MEDIA_CONCURRENCY`.

Without storage configured, the API still boots and media endpoints return 503. The readiness check covers storage once it is configured.

**New admin settings:**

| Setting | Default | Meaning |
|---|---|---|
| `media.maxImageMb` | 15 | Largest photo upload |
| `media.maxVideoMb` | 250 | Largest video upload |
| `media.maxVideoSeconds` | 60 | Longest video or reel; covers the spec's 15, 30 and 60 seconds, or more if allowed |
| `posts.maxMediaPerPost` | 10 | Most photos or videos in one post |
| `reports.autoHideThreshold` | 0 (off) | Distinct reports before content is hidden while awaiting review |

## 5. Endpoints

The API now has 93 operations, up from 62. `docs/API.md` is generated from the running API by `scripts/gen_api_md.py`.

## 6. Tests

| Suite | Result |
|---|---|
| API unit | 55 passed (new: hashtag parsing including Indian scripts, cursors) |
| API end-to-end, Phase 1 | 28 passed |
| **API end-to-end, Phase 2** | **23 passed**, against real Postgres, Redis, an S3 API (moto) and the real worker with sharp and FFmpeg |
| Both end-to-end suites with split internal/public storage endpoints | 51 passed |

**What the Phase 2 end-to-end tests prove:**

- **Privacy:** a photo with real GPS EXIF comes out as WebP with no metadata at all, and originals are never exposed.
- **Video:** a 3-second portrait reel becomes HLS at 720x1280 and 360x640 with a poster.
- **Rejections:** fake images, videos over the limit and size mismatches are all refused.
- **Publishing:** a post waits in PROCESSING while the worker is stopped and publishes when it resumes.
- **Feeds:** cursor pages have no duplicates; followers-only posts are invisible to non-followers and to trending; trending ranks by engagement after the score job runs.
- **Engagement:** likes, saves and views are counted once; comment counts stay correct through deletes and moderation.
- **Blocking:** blocked people disappear everywhere, and their follows are removed.
- **Moderation:** auto-hide, dismiss-and-restore, remove, hide a comment, and suspend only with permission. A Support agent can view cases but can't resolve them.
- **Feature flag:** turning off `ENABLE_REELS` disables all of the above.
- **Upgrades:** an existing Phase 1 install picks up the new permissions.

**Real bugs the tests caught and I fixed:**

1. **Hashtags in Indian scripts were cut short.** `#कुत्ता` became `#क` because vowel signs are Unicode combining marks. Tamil and Bengali were affected the same way.
2. **URL fragments became hashtags.** `example.com/#anchor` was read as the tag "anchor".

## 7. Setup

1. `docker compose up -d postgres redis minio minio-init`
2. `npm run db:deploy`
3. `npm run db:seed`
4. `npm run dev`, and `npm run worker` in a second window (needs FFmpeg).
5. Turn on **Reels and posts** in the dashboard under Features & settings.

`docker compose up --build` runs everything, including the worker and MinIO.

## 8. Deployment

- The runtime image includes FFmpeg.
- Run the worker as a separate service with `node apps/backend/dist/worker.js`, and scale it on its own.
- Put a CDN in front of the bucket's `media/` prefix and set `MEDIA_PUBLIC_BASE_URL`.
- Add a lifecycle rule on `uploads/` if originals shouldn't be kept indefinitely. They're kept so media can be reprocessed.
- CI now installs FFmpeg and an S3 test server for the end-to-end job.

## 9. Known limitations

- **No dashboard screen yet** for moderation (the API is complete), notifications or push. These are Phase 2b.
- **@mentions** in captions are not parsed yet. They'll arrive with notifications in 2b, which is where they matter. Pet tagging works.
- **Feeds scale to the low hundreds of thousands of users** with the current live queries. Beyond that, precomputed per-user Redis feeds are the planned next step.
- **No resumable uploads** (spec item 84). A single signed PUT is fine for files up to the 250 MB default. Multipart resumable uploads come with the mobile app.
- **No AI moderation yet** (Phase 7). Cases record report reasons, and the AI assessment will plug into the same queue.
- **Docker and GitHub workflows weren't run here**, because the sandbox has no Docker daemon.

## 10. Next: Phase 2b

- The moderation queue in the admin dashboard.
- A notifications service: in-app notifications, preferences, FCM push, and @mentions.
- The Flutter customer app: sign-in, pets, feed, reels player, upload and comments.
