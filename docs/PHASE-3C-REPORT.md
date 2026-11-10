# Phase 3c — Challenges, badges, contest notifications and judging: report

## 1. Implemented

### API

- **Challenges:** free, paid (Razorpay, or the development fake) or contest-linked (only that contest's entrants can join).
  - **Builder:** window, check-ins to complete, proof per check-in (none, a post, or a note), points, streak bonus and completion badge.
  - **Publishing:** blocked until the setup is consistent, for example "30 check-ins can't fit in 6 days".
  - **Lifecycle:** draft → published → ended, or cancelled. Cancelling a paid challenge queues refunds.
- **Check-ins:**
  - **Rules:** one per **India calendar day**, inside the window, with the required proof, and the row is locked against double taps.
  - **Streaks:** build on consecutive days and reset after a gap. Bonus points come every N days in a row.
  - **Completion:** happens exactly once, awarding the badge and sending notifications.
- **Rankings:** points, then longest streak, then join order, plus the viewer's exact rank.
- **Badges:** created by admins, earned through challenges, and shown on profiles (`/users/me/badges`, `/users/:id/badges`).
- **Contest notifications:** "You're in!" (free entry or verified payment), "Voting is open", and results ("You won! 🏆 Bolt won "Gold" in Trick Cup." for winners, a thank-you for everyone else).
- **Permissions:** new `challenges.manage` (Admin). Viewing uses `contests.read`. Challenges share the **Contests** feature switch.

### Dashboard

- **Challenges:** a list, a create form, and a detail page with publish, end and cancel, the setup, a readiness list and live rankings.
- **Badges:** a list with award counts, and Add badge.
- **Audit log:** plain-language labels for challenge and badge events.

### App

- **Challenges** (flame icon on Home): Active, Upcoming and Past tabs.
  - **Joining:** free, paid, or for contest entrants.
  - **Daily check-in:** with a post or a note.
  - **Progress:** a progress bar, the streak with your best, points, and rankings with your rank.
- **Badges** appear on your profile.
- **Judging** (gavel icon on your profile, for accounts with the Judge role): assigned contests, each entry's submissions, a 0–10 slider per criterion with its weight, and the weighted score shown live using the same formula as the leaderboard.
- Notifications about challenges and badges open the right screen.

## 2. Tests

| Suite | Result |
|---|---|
| API unit | **84 passed**. New: the India-day boundary (11:59 pm vs 12:01 am IST), streaks, bonuses, one-per-day, reset after a gap, completion exactly once, and the live streak display |
| API end-to-end | **75 passed** in 5 suites. New: **6 challenge and notification tests** with the real worker |
| Dashboard unit | 7 passed |
| Dashboard browser | **12 passed**. New: create a badge and a challenge in the form, publish it, and check the history |
| App contract | **69 API calls and 219 field reads across 36 models** match real responses (new fixtures: challenges, badges and a judge account scoring an entry) |
| App fixture assertions | 21 of 21 new assertions hold |
| App brackets | 37 files, no problems |

**What the new end-to-end tests cover:**

- **Publishing:** inconsistent setups are refused.
- **A full challenge:** three days of check-ins with exact points (10, then 35 with the bonus, then 10, for 55), one per day, the badge awarded and the completion and badge notifications delivered with their exact wording.
- **Missed days:** a gap resets the streak but keeps the points.
- **Rankings:** 55 / 45 / 10, with the viewer at #3.
- **Paid challenges:** payment first, then check-ins; cancelling queues the refund.
- **Contest-linked challenges:** refused until the person has entered the contest.
- **Contest notifications:** entry confirmed, voting open, and "You won!".

The recorded judge score of **8.4** equals 9 × 60% + 7.5 × 40%, which confirms the weighting end to end.

## 3. Bugs found and fixed

1. **The new challenge form would wipe typed text when "Who can join" changed.** A helper component was defined inside the form, so React treated it as a new component on every render. It now lives outside the form, and the browser test types a title, switches the option twice, and checks the title survives.
2. **The form's time-zone offset was computed during server rendering**, where it is always 0, so times would have been misread for anyone outside UTC. It's now read in the browser after load.
3. **Shared labels were exported from a Next.js page file**, which Next's build rejects. They now live in their own module.
4. **A flaky browser assertion:** the contest test matched "legal review" text that now appears twice in the dialog. It now matches the exact error message.

## 4. Known limitations

- **The Flutter app is still not compiled here.** CI's `mobile` job compiles and tests it.
- **No check-in reminders.** A daily "keep your streak" push needs a scheduled job; it's planned with the notification scheduler in Phase 8.
- **Badge images:** badges have an optional icon URL, but there's no upload screen for it yet.
- **Refunds and payouts are recorded but not executed.** That's Phase 6.

## 5. Phase 3 is complete

Contests, payments, challenges, streaks, badges, notifications and judging are all done.

**Next is Phase 4, the services marketplace:** partner onboarding and verification, services and time slots, nearby search, bookings and the partner app.
