# Phase 3b — Contest screens: report

## 1. Implemented

### Admin dashboard

The menu has a new **Contests** item, shown to anyone with `contests.read`.

| Screen | What it does |
|---|---|
| **Contests** | List with status filter, entry fee and entries against the maximum. Links to Categories and New contest. |
| **Builder** (new and edit) | Basics, entry (fee in rupees, minimum and maximum, eligible species), the four dates, tasks, scoring (public/judge slider, votes per day, minimum account age), judging criteria with a live weights total, judges (accounts with the Judge role), prizes (ranked or special), the money split with a live percentage total and a preview at maximum entries ("₹10,000 collected, ₹6,000 prize pool, ₹0 unallocated"), and rules and terms. Editing is allowed only in draft or review, and the page warns that changing the fee clears the legal review. |
| **Control room** | Only the next lifecycle steps are offered, each explaining what it does; cancelling needs a reason. A readiness checklist for drafts. A **legal review** panel that shows whether it's recorded and, for super admins only, a button to record it with the reviewer and reference. **Money:** collected so far plus the split for paid entries so far, at minimum, at maximum and "what if N people enter", with shortfalls in red. A live or frozen **leaderboard** with qualify, finalist or disqualify decisions (a reason is required). **Votes held for review**, with the reasons in plain words and count or exclude. **Freeze leaderboard** and **Declare winners** buttons, **special awards** given from the leaderboard, prize payout status, and the contest's history. |
| **Categories** | Grouped list, add a category, show or hide each one. |

The audit log now describes contest and payment events in plain language, such as "Recorded the legal review" and "Rejected a payment with the wrong amount".

### Customer app

- **Contests** opens from a trophy icon on Home, shown only when the Contests feature is on. It has Live, Upcoming and Past tabs, with fee, entries, status and the top prize.
- **Contest page:**
  - **Details:** the facts (fee, entries, deadlines, how the winner is decided), prizes, tasks, rules and terms.
  - **Entering:** choose a pet (pets already entered are greyed out), then pay through Razorpay checkout. With the development API's fake gateway it completes immediately. Payments are always confirmed by the server; the app never decides on its own.
  - **Your entry:** shows its status, a "complete payment" button while the place is held, and the tasks with a tick when done. Post tasks open a picker of your own posts; text tasks open a short answer box.
- **Leaderboard and voting:** ranks, votes and score. During voting there's a Vote button on every entry except your own, with the server's messages (daily limit, already voted, account too new) shown as written.
- Notifications about a contest open the contest.

## 2. Tests

| Suite | Result |
|---|---|
| Dashboard unit | 7 passed. New: rupee formatting (`₹1,00,000`, `₹199.50`) and exact rupee-to-paise parsing (0.29 → 29, with no floating-point drift) |
| Dashboard browser (Playwright) | **11 passed**. New: build a paid contest in the form, send for review and schedule, confirm the legal gate blocks going live, record the review as super admin, go live, and check the "what if 100" money table (₹10,000 / ₹6,000) and the history entry |
| App contract (no Flutter needed) | **60 API calls and 160 field reads across 26 models** match real responses. 8 new contest fixtures were recorded by running a paid contest through the API (register, pay, submit, vote, leaderboard) |
| App fixture assertions | 15 of 15 contest assertions hold against the recorded data |
| App brackets | 34 files, no problems |
| API | Unchanged since 3a: 78 unit and 69 end-to-end tests pass |

**A bug the tests caught:** amounts like ₹199.50 displayed as "₹199.5". Whole rupees now show no decimals, and anything else always shows two.

The recorded leaderboard shows the newly created voter's vote as **held**, which is correct: brand-new accounts' votes wait for review.

## 3. Setup notes

- **Dashboard:** no new settings. Give someone the **Judge** role under People before building a judged contest.
- **App:** the `razorpay_flutter` package was added. See `apps/customer-mobile/README.md` for the Android release ProGuard rules and the iOS `pod install` step.
- **Turning contests on:** switch on **Contests** in Features & settings, and **Public voting** if you want voting.

## 4. Known limitations

- **The Flutter app is still not compiled here.** The contract checks above cover how it talks to the API; CI's `mobile` job compiles and tests it.
- **No contest notifications** (entry confirmed, voting open, results). They need new notification types and will come with challenges in 3c.
- **No judging screens.** Judges score through the API (`/judge/...`). A judging screen in the app or dashboard is a small follow-up.
- **Refunds and prize payouts are recorded, not executed.** That's Phase 6.
