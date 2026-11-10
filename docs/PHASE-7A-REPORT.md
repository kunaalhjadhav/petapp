# Phase 7a — AI moderation assist and account risk: report

Phase 7 is split into three parts: **7a** AI moderation and account risk (this report), **7b** recommendations and admin-controlled home sections, **7c** the PetApp Assistant (behind `ENABLE_AI_ASSISTANT`, with vet guardrails).

## 1. Implemented

### AI moderation (spec §33)
New and edited content is checked automatically in the background:
- **What's checked:** posts (caption and photos), comments, pet profiles (name and about), user names, product listings (title, description, brand, photos), service reviews with a comment, and contest entries.
- **What it looks for:** spam, unsafe content, abuse, fake profiles, duplicates (copied photos or the same text from several accounts), inappropriate content and suspicious contest entries.
- **What's stored:** every check is kept as an `AiAssessment` with the result, confidence, reason, provider, model, version, timing and any error. A check is skipped when the content hasn't changed since the last one.
- **It never decides.** A confident result opens (or adds to) a case in **Moderation**, marked "Flagged by AI". A moderator always makes the decision.
  - **Optional hiding while waiting:** off by default (`0`). If an admin sets a threshold, items above it are hidden until the moderator decides; dismissing the case shows them again. Contest entries are never hidden by AI.
  - Everything is in the audit log: `moderation.ai_flag` and `moderation.auto_hide`.
- **Providers (no hard-coding):**
  - `rules` (default): PetApp's built-in rules for obvious spam, scams, abuse and copied photos. No external calls.
  - `anthropic`: Claude via the Messages API, with a forced structured answer. Images are sent by URL. User text is fenced so it can't instruct the model. Rate limits and server errors are retried (4 attempts with backoff); the last failure is stored as a failed check rather than lost.
- **Copied photos:** every uploaded photo and video poster now gets a perceptual fingerprint. A near match from another account counts as a duplicate (strongly for contest entries, weakly for products, where shared catalogue photos are normal).
- **Admin dashboard → Community → AI moderation:**
  - **Status:** on or off, which provider, and the last 24 hours (flagged, clear, failed).
  - **Settings:** turn checking on or off, the confidence needed to open a case, and the optional hide threshold. The hide threshold can't be lower than the case threshold.
  - **Checks:** flagged, failed, or everything checked, each with its reason and model version.
- **Moderation queue:** a "From AI / From reports" filter; an AI tag on rows; and on the case page, the AI panel with the reason, the scores per label and the history of earlier checks. Cases with no reports from people say so.

### Account risk (spec §14)
Each account can get a risk score from 0 to 100:
- **Signals:** a very new account, an unverified phone, many accounts on the same network, held contest votes, bursts of votes, payment anomalies, copied photos, AI flags and open cases. Each signal shows its points and a plain-language detail.
- **When it's scored:** after votes, after an AI flag, on demand ("Score again"), and in a nightly sweep at 03:45 IST.
- **What a high score does:** it lists the account under **Community → Account risk → To review**. Nothing else. No account is ever blocked, suspended or banned automatically.
  - If the setting `risk.holdVotesFromHighRisk` is on (default), contest votes from accounts waiting for review are held for review rather than counted straight away, using the existing held-vote flow.
- **Review:** staff record what they found. The account then moves to **Reviewed** and only comes back if the score rises by 10 or more. Suspending remains a separate, manual action on the profile page.
- Audit entries: `risk.high` and `risk.review`.

### API additions
- `GET /admin/ai/status`, `GET /admin/ai/assessments`, `POST /admin/ai/assess` (re-check an item)
- `GET /admin/risk`, `GET /admin/risk/{userId}`, `POST /admin/risk/{userId}/recompute`, `POST /admin/risk/{userId}/review`
- Moderation cases accept `source=ai|reports` and include the AI check.
- API reference regenerated (287 operations).

### Settings and configuration
- **Environment:** `AI_PROVIDER` (`rules` or `anthropic`), `ANTHROPIC_API_KEY` (required for `anthropic`), `ANTHROPIC_BASE_URL`, `AI_MODERATION_MODEL` (default `claude-haiku-5-5`), `AI_TIMEOUT_MS`, `TRUST_CONCURRENCY`.
- **Platform settings (editable in the dashboard, audited):** `ai.moderationEnabled`, `ai.flagPct` (70), `ai.autoHidePct` (0), `ai.maxImages` (4), `risk.reviewScore` (60), `risk.mediumScore` (30), `risk.holdVotesFromHighRisk` (true).

### Database
Migration `20261013090000_ai`: `AiAssessment`, `AccountRisk`, `MediaAsset.perceptualHash`, AI fields on `ModerationCase`, and new report target types (product, service review, contest entry), with range checks on scores and confidence.

## 2. Verification
- **Backend unit tests:** 153 pass, including the label rules, fingerprint distance, risk weights and both providers (the Claude provider against recorded HTTP responses: success, forced tool output, retryable and non-retryable errors).
- **Backend end-to-end:** 135/135, including 12 new trust tests (flag → case → audit; unchanged content not re-checked; failures retried then stored; optional hiding and restoring; copied photo detection; risk scoring, review and re-listing; held votes from high-risk accounts; permissions; the real queue).
- **Dashboard browser tests:** 19/19, including 3 new ones (AI-flagged case through to a decision; AI settings with the threshold rule; risk review).
- **Live check:** a spam comment posted through the API was flagged by the worker within seconds, a case opened, and the author's risk score was recalculated.
- Lint and typecheck clean; all three app contract checks still pass.

## 3. Problems found and fixed
- **Background jobs silently dropped:** the queue rejects job IDs containing `:`, so the first version's AI and risk jobs never ran. Found during the live check; IDs fixed, and an end-to-end test now runs a real queue job.
- **Contest entries have no direct post link:** the entry's post is now loaded separately for checks and previews.
- **Moderators could have hidden a contest entry from a case:** blocked (contest entries are disqualified through the contest tools instead).
- **Dashboard polish:** audit log labels for the new actions; layout fixes on the AI and risk pages.

## 4. Known limitations
- **Copied-photo search scans all fingerprints.** Fine at current volumes; at scale it needs a dedicated index (e.g. BK-tree or an extension).
- **Local images aren't reachable by Claude.** With local MinIO, the `anthropic` provider can't fetch image URLs; it works with a public or presigned storage URL in production.
- **The Claude provider has only been tested against recorded responses here,** because this environment has no API key. Try it with a real key in staging before turning it on.
- **Not yet checked by AI:** chat messages, and the audio of reels.
- **Risk lists** load high-risk rows into memory to apply the "risen since review" rule; fine for thousands, worth moving into SQL later.

## 5. Next: Phase 7b
Recommendations (pets, posts, services and products) and home-screen sections controlled from the admin dashboard.
