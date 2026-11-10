# Phase 6a — Finance core: report

## 1. Implemented

### Double-entry ledger
- **Postings:** every money event is a balanced posting, written in the same database transaction as the business change.
- **Database guards:**
  - Each line is one-sided and positive.
  - Every transaction has at least two lines with debits = credits (checked at commit).
  - Rows are append-only; corrections are reversing postings.
  - `reference` is unique, so a posting can never be made twice.
- **Accounts:** system accounts (gateway clearing, customer funds, refunds due, fee revenue, GST on fees, TCS, TDS, PetApp coupons, bank) plus one account per seller and per partner.

| Event | What's posted |
|---|---|
| Any payment captured (shop, booking, contest, challenge) | The gateway holds it for the customer |
| Refund owed (cancellation, return, late booking cancellation, cancelled contest or challenge, payment that can't be honoured) | Customer funds → refunds due |
| Refund confirmed by the gateway, or paid by staff another way | Refunds due → gateway (or bank) |
| Parcel delivered | Customer funds (+ PetApp-funded coupon) → PetApp fee (GST split out), TCS, TDS, seller |
| Return received | The delivery posting reversed; the seller keeps any shipping the customer isn't refunded |
| Visit completed, no-show, late cancellation | Customer funds → PetApp fee, TCS, TDS, partner |

### Fees and taxes (all admin settings)
- **Fees:** commission and booking fees include 18% GST; PetApp's revenue is the fee without it.
- **GST TCS** (default 0.5%): only from GST-registered sellers and partners, on the taxable value (price less the GST inside it, after discounts).
- **Income-tax TDS** (default 0.1%, or 5% when no PAN is on file): from everyone. Sellers and partners can now add a **PAN** to their profile.
- Rates must be confirmed with a tax adviser; the settings say so.

### Refunds are actually sent now
- **Worker:** every 30 seconds it sends owed refunds to the gateway (Razorpay refunds API; a fake gateway for development and tests).
- **Never twice:**
  - Each attempt has its own receipt and idempotency key.
  - Earlier attempts are looked up first, so a timeout and a retry can't refund twice.
  - A refund the bank rejected can be tried again.
- **Retries:** errors back off (2, 4, 8 … minutes, up to 6 hours). Refusals and exhausted attempts become **FAILED** for finance staff, who can retry, or record that they paid the customer another way (with the transfer reference).
- **Completion:** confirmed by the create response, the signed `refund.processed` webhook, or polling.
- **Payment status:** follows its refunds (refund pending → partially refunded / refunded).
- **Customers** get a "Refund sent" notification that opens the order or booking.

### Reconciliation (nightly 02:30 India time, or from the API)
- **Repairs:** posts anything missing, so upgrading backfills the ledger from existing data.
- **Control checks** (one consistent snapshot):
  - The ledger balances.
  - Gateway clearing = captured − refunds sent.
  - Refunds due = unpaid refunds.
  - Customer funds never negative.
  - No over-refunds.
  - Capture postings match payments.
- **Gateway checks** for recent payments: captures we never heard about (recoverable with one call), double charges, amount mismatches, and refunded totals.
- **Issues:** open until resolved with a note; not raised twice.

### API
- **Staff** (new **Finance** role, permissions `finance.read` and `finance.manage`):
  - overview (balances now, flows in a period, refunds, last run, open issues)
  - trial balance
  - accounts and payees
  - account lines
  - transaction detail
  - refunds (list, retry, settle manually)
  - reconciliation (run, runs, issues, resolve)
  - recover a missed payment
  - monthly TCS/TDS report per payee with GSTIN/PAN and taxable value
- **Sellers and partners:** `GET /vendor/statement` and `GET /partner/statement` list every line with the sale, PetApp's fee, TCS and TDS behind it. Their earnings responses now include `balancePaise`, what PetApp owes them.

## 2. Verification

| Check | Result |
|---|---|
| API end-to-end | **110 passed** in 8 suites. New: finance suite with 13 tests; the finance and marketplace suites were each run 3 more times, all green |
| API unit | **118 passed**. New: fee/tax split exact on hand-worked examples and invariant on 500 random sales; GST matches the price rules; backoff; payment status; receipts; Razorpay refund calls, errors and webhooks |
| Lint, types, build (API, dashboard, types) | Clean |
| App ↔ API contracts (customer, partner, seller apps) | All still match |
| Ledger to the paisa | ₹348 parcel → fee ₹35.88 (₹5.47 GST), TCS ₹1.27, TDS ₹0.25, seller ₹310.60. ₹799 visit, no PAN → fee ₹119.85, TDS ₹39.95, partner ₹639.20 |
| Database guards | Unbalanced, single-line, two-sided and negative lines are refused at commit; updates and deletes are refused |
| Backfill on the development database | The first reconciliation repaired 22 missing postings. The trial balance balanced and customer funds ended at ₹0 |
| Independent review | A separate reviewer read the finance code and call sites. Its 8 definite bugs and the most important risks were fixed (§3) |

## 3. Problems found and fixed

**Found while building:**
1. **Paid entries could be kept without a refund.** A contest or challenge payment that arrived after the entry was withdrawn or replaced was captured and silently kept. Such payments are now refunded in full.
2. **A database trigger referenced a column that doesn't exist.** The balance check failed at the first commit; the tests caught it.

**Found by the independent review:**

3. **Booking races.** Cancelling and completing the same visit at once could both succeed (partner paid and customer refunded). A cancellation racing a payment could lose the refund. Both now move only from the status they were decided on; a test races them.
4. **Contest/challenge cancellation race** with a capture in flight could withdraw a paid entry without refunding it. The capture now locks the contest or challenge.
5. **A refund the gateway failed could never succeed:** the retry kept finding the failed attempt. Each attempt now has its own receipt, and failed attempts are skipped.
6. **Stale "failed" reports** could knock a refund off its in-flight attempt. Now only the attempt in flight can fail it.
7. **A webhook whose handling failed was dropped** as a duplicate when the gateway retried it. It's now handled again.
8. **Payment status lost updates** when two refunds completed together; the payment row is now locked.
9. **No way to settle a refund outside the gateway:** the issue reappeared nightly. Added "settle manually" with a reference and a proper posting.
10. **Two cancellations owing the same refund at once** made one of them fail with an error; the check now happens under the lock.
11. **Also fixed:**
    - Postings no longer open a second database connection (rates are cached briefly).
    - Numeric settings are validated: whole, non-negative, rates capped.
    - Gateway calls time out after 30 seconds.
    - Large sums use 64-bit maths.
    - A return can't be received twice.
    - Sellers' and partners' month-by-month earnings were grouped about 11 hours off India time.

## 4. Known limitations

- **No payouts yet.** Payee balances accumulate; bank details, payout batches and the payout provider are Phase 6b. Gateway settlements to PetApp's bank aren't booked yet, so "held by the gateway" grows until then.
- **No invoices yet** (commission invoices to sellers, tax invoices to customers): Phase 6b.
- **Contest and challenge entry fees** stay in customer funds until prize payouts and revenue recognition arrive in Phase 6b. Refunds for them work now.
- **No dashboard screens yet** for finance; everything is available through the API (Phase 6b). The apps don't show statements yet (Phase 6c).
- **TDS threshold exemptions** (e.g. small individual sellers) aren't applied: TDS is always deducted, which is the cautious choice.
- **Backfilled postings use today's rates and PANs**, dated when the event happened.
- **`TRUNCATE` isn't blocked by the ledger's row triggers.** In production the app's database user should not hold it (see DEPLOYMENT.md).

## 5. Next: Phase 6b, payouts and invoices

Payee bank accounts with verification, payout batches through RazorpayX (with a fake for development), approval and audit, contest prize payouts with TDS on winnings, invoices, and the dashboard's finance screens.
