# Phase 3a — Contest engine and payments: report

## 1. Implemented

| Area | What it does |
|---|---|
| **Categories** | Admin-managed and grouped (Beauty, Talent, Fun, Photography, Skills, Challenge, or any new group) |
| **Contest builder** | Title, description, banner, category, fee, minimum and maximum entries, four ordered dates, public/judge weighting, votes per day, minimum account age, eligible species, rules, terms, money split, tasks (post or text), weighted judging criteria, ranked and special prizes, judges (accounts with the Judge role). All configurable, none hard-coded. A readiness list shows exactly what's missing. |
| **Lifecycle** | DRAFT → REVIEW → SCHEDULED → LIVE → VOTING → EVALUATION → WINNER_DECLARATION → COMPLETED, or CANCELLED, with every step validated (see the architecture doc, section 12). Editing is only possible in draft or review. Changing the fee clears an earlier legal review. |
| **Legal gate** | Paid contests can't go live without a recorded legal review: who approved it, when, and the reference. This is a separate permission held only by super admins by default. |
| **Money split** | Prize pool, platform fee, GST on the platform fee, gateway fee, promotion, refund reserve and fixed judge fees, in integer paise with percentages accurate to 0.01%. A preview shows the split at any number of entries, the actual figures from captured payments, and whether the fixed costs fit. |
| **Payments** | A provider abstraction with Razorpay (Orders API, checkout signature, signed webhooks) and a development fake that uses the same signature scheme and is refused in production. A payment counts only when the server verifies it. Webhooks are stored once by event ID and the amount is re-checked. |
| **Registration** | Free contests: in immediately. Paid contests: a payment order is created and the place held for 30 minutes. The contest row is locked during registration so the last place can't be sold twice. Retrying returns the same order, so nobody is charged twice. Eligibility and ownership are checked. |
| **Submissions** | One per task. POST tasks take one of your own published posts; TEXT tasks take an answer. The entry becomes SUBMITTED when all required tasks are done. |
| **Public voting** | Behind its own feature flag. Requires a verified phone and the minimum account age, enforces the daily limit, allows one vote per entry per day, and no voting for your own entry. Risky votes are flagged with explained reasons and don't count until reviewed. Nobody is banned automatically, and voters aren't told when their vote was flagged. |
| **Judging** | Only assigned judges, scoring each criterion 0–10. Each judge's score is a weighted average, and judges are averaged together. Judging closes at the freeze. |
| **Leaderboard** | Combines public votes and judge scores by the contest's weighting. Live with a 30-second cache. Freezing stores a snapshot, and winners are declared from that snapshot. |
| **Winners and prizes** | Ranked prizes are assigned from the frozen ranking; special awards are given by hand. Prize payouts start as PENDING and are paid out in Phase 6. |
| **Entry management** | Qualify, shortlist as finalist, or disqualify with a reason. Changes are locked after the freeze. |
| **Cancellation** | A reason is required. Captured fees become REFUND_PENDING, entries are withdrawn, and the reason is shown publicly. |
| **Audit** | Every admin action, legal approval, freeze, winner declaration, payment capture, invalid signature and amount mismatch is recorded. |

## 2. Permissions

- `contests.read`: Admin and Moderator.
- `contests.manage`: Admin.
- `contests.legal_approve`: **Super admin only**. It's deliberately excluded from Admin.

Existing installs receive these through the upgrade-safe permission sync added in Phase 2a.

## 3. Migration

`20261003090000_contests` adds 13 tables and 4 enums, purely additive. The generator still reproduces every earlier migration exactly.

## 4. Environment

`PAYMENT_PROVIDER` (`fake` or `razorpay`), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`. The fake provider is refused in staging and production, and the Razorpay keys are required when it is selected.

**Webhook URL:** `/api/v1/webhooks/payments` (events `payment.captured`, `payment.failed`, `order.paid`).

## 5. Endpoints

The API now has 131 operations, up from 100. They're listed in `docs/API.md`, with the access level and feature flags for each.

## 6. Tests

| Suite | Result |
|---|---|
| API unit | **78 passed**. New: the money split, including the spec's exact 100 × ₹100 example, rounding that never creates paise, and splits over 100% rejected; weighted scoring and tie-breaks; vote risk; readiness; Razorpay checkout and webhook signatures, including tamper detection; order creation; environment rules. |
| API end-to-end | **69 passed** in 4 suites. New: **11 contest tests** on real Postgres and Redis. |

**What the contest tests prove:**

- **Builder:** readiness blocking, and judges must have the Judge role.
- **Money:** the finance preview.
- **Legal gate:** refused for a regular admin, recorded by a super admin.
- **Payment security:**
  - a fake signature is refused;
  - a webhook with a bad signature is refused;
  - a correctly signed webhook with the wrong amount is caught;
  - a genuine signature succeeds;
  - a redelivered webhook is a no-op;
  - asking to register again returns the same order.
- **Registration:** species eligibility, pet ownership, and the full-contest message on the last place.
- **Submissions:** someone else's post is refused; the entry becomes SUBMITTED.
- **Voting:**
  - the voting feature flag;
  - no voting for your own entry;
  - the daily limit;
  - a brand-new account's vote is flagged with explained reasons and counts only after review.
- **Judging:** a non-assigned judge is refused, scores over 10 are refused, and the weighted maths gives a final board of **86.67 / 70 / 42**, exactly as calculated by hand.
- **Finishing:** freeze ordering, judging closed after the freeze, winners from the snapshot, a special award, completion and the audit trail.
- **Cancellation:** refunds queued and entries withdrawn.
- **Visibility:** free contests register instantly, drafts are hidden, and the feature flag hides everything.

Lint and type checks are clean. The mobile app's API contract check still passes against the changed API.

## 7. Known limitations

- **No screens yet.** The contest builder and vote review in the dashboard, and the contest, entry, checkout, voting and leaderboard screens in the app, are Phase 3b. Everything is available through the API.
- **Refunds and prize payouts are recorded but not executed** (REFUND_PENDING, payout PENDING). Execution, along with the double-entry ledger, GST invoices and TDS on prize winnings, belongs to Phase 6.
- **Paid votes** (`ENABLE_PAID_VOTING`) are not implemented and remain off. They need their own legal review.
- **No contest notifications** yet (registration confirmed, voting open, results). They'll be added with the screens in 3b, using the existing notifications system.
- **Real Razorpay not exercised here.** Razorpay's API isn't reachable from this sandbox. The provider is tested against Razorpay's documented signature scheme and a scripted HTTP client; the full flow runs end to end on the development fake, which uses the same scheme.

## 8. Before running a real-money contest

The code enforces the legal-review gate, but the review itself is a business step:
- Confirm the contest structure is a game of skill under the laws of the states you operate in.
- Confirm the GST treatment of entry fees and the platform fee.
- Confirm the TDS obligations on prize winnings.
- Publish the contest terms and refund policy.

Record the counsel's reference in the legal-approval note.
