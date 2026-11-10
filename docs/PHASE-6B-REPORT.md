# Phase 6b — Payouts, prizes, settlements and invoices: report

## 1. Implemented

### Paying sellers, partners and winners
- **Payout accounts** (bank account or UPI), for sellers, partners and prize winners:
  - **Encrypted:** the account number is stored with AES-256-GCM and never returned; only the last four digits are shown.
  - **Validated with the bank:** RazorpayX's ₹1 check confirms the account is active and returns the holder's name.
  - **Safe replacement:** a new account replaces the old one only once verified, so payouts never pause.
  - **Takeover protection:**
    - A 24-hour safety hold applies to a replacement, or to any account whose bank name isn't one of the payee's names (business, legal or owner's).
    - At most three changes a day.
    - The payee is notified of every change.
  - **Staff** can switch off an account reported as fraudulent.
- **What's payable:** earnings become payable 7 days after delivery or the visit (the return window). Returns and refunds count at once. Prizes, and payouts that bounced, are payable at once. All settings.
- **Maker-checker batches:**
  - **Prepare:** one finance person prepares a batch of everyone due at least ₹100 with a verified account.
  - **Approve:** a different person approves. Each payee's balance is re-checked under a lock, and the money moves to "in transit", so it can't be paid twice. The database allows one open payout per payee.
  - **Send:** the worker sends each payout through RazorpayX: IMPS up to ₹5 lakh, NEFT above, UPI for UPI IDs. The payout id is the reference and idempotency key.
  - **Confirm:** a signed webhook or the status poll confirms the bank result.
  - **Notifications:** payees are told when money is sent (with the bank reference), returned, or couldn't be paid.
- **When things go wrong:**
  - **Refused:** the amount goes back on the payee's balance for the next batch.
  - **Timeouts and outages:** never treated as failures, because the money may have gone. The payout is retried, looked up before each attempt, then left for the status check.
  - **Returned by the bank, even days later:** the amount goes back on the balance.
  - **Account switched off after approval:** nothing is sent.

### Contests and prizes
- **Entry fees:** when a contest completes or a challenge ends, the entry fees still held become revenue, with GST split out. A payment arriving after that is refunded.
- **Cash prizes:** finance approves each awarded cash prize. TDS on winnings (30% above ₹10,000; settings) is deducted, the rest is owed to the winner, and it's paid through a batch. The prize is marked paid when the payout that carries it is paid.

### Gateway settlements
Synced nightly (and on demand). Each transfer from the gateway to PetApp's bank is booked: money to the bank, the gateway's fees as an expense, and the GST on them as input credit. Reconciliation now also checks money held at the gateway against settlements, and payouts in transit against payout records.

### Invoices
- **Customer invoices:**
  - **Seller's tax invoice to the customer** on delivery, issued by PetApp on the seller's behalf:
    - CGST+SGST within a state, IGST across states.
    - The discount is spread across items, and shipping is taxed at the main item's rate.
    - A bill of supply if the seller isn't GST-registered.
  - **Credit note** when a return is refunded, mirroring the original invoice.
  - **Partner's invoice** for a completed visit.
- **PetApp's monthly commission invoice** to each seller and partner, from the ledger's fees. Only for a finished month, and only once company details are set.
- **Numbering:** gapless and consecutive per issuer, document type and financial year, at most 16 characters (e.g. `WAGI/2627/00001`).
- **Immutable:** issued invoices can't be changed (a database trigger).
- **PDFs:** customers, the seller or partner, and finance staff can download them. Anyone else gets "not found".

### API
- **Payees:**
  - `GET /vendor|partner|me/payouts`: balance, payable now, account, history.
  - `GET|POST /vendor|partner|me/payout-account`
  - `GET /me|vendor|partner/invoices`, `GET /invoices/{id}/pdf`
- **Staff:**
  - payout preview
  - batches (prepare, list, view, approve, cancel)
  - payout accounts (list, switch off)
  - prizes (list, approve)
  - settlements (list, sync)
  - invoices (list, PDF, issue commission invoices for a month)
- **Webhook:** `POST /webhooks/payouts` (RazorpayX, signature-checked, idempotent).

## 2. Verification

| Check | Result |
|---|---|
| API end-to-end | **122 passed** in 9 suites. New: payouts suite with 12 tests. The money suites were run twice more, all green |
| API unit | **132 passed**. New: invoice rules (financial year at the 31 March midnight boundary, numbering limits, GST split, parcel lines adding up exactly); payout rules; encryption (tamper detection, wrong key); RazorpayX requests, statuses, errors and webhooks; fake provider |
| Lint, types, build | Clean |
| App ↔ API contracts | Customer, partner and seller apps still match |
| Worked examples | ₹348 parcel, Maharashtra seller to a Karnataka buyer: IGST ₹53.08 (₹45.61 on the item + ₹7.47 on shipping). Monthly commission ₹35.88 within Maharashtra: CGST ₹2.73 + SGST ₹2.74. ₹15,000 prize: TDS ₹4,500, winner paid ₹10,500. ₹99 entry fee: revenue ₹83.90 + GST ₹15.10 |
| Independent review | A separate reviewer read the payouts, prizes, settlements and invoices code. Its 8 definite bugs and the main risks were fixed (§3) |

## 3. Problems found and fixed

**Found by the independent review:**
1. **A payout could be paid twice.** After repeated timeouts it was marked failed and its money returned to the balance, although the provider might already have paid it. Timeouts now never fail a payout; only a definite refusal does.
2. **A payout returned by the bank before we saw it paid** was ignored, and the money was stuck in transit. It now goes back on the balance.
3. **Commission invoices counted fees twice** on returns where the seller kept the shipping charge.
4. **A switched-off account could still receive** a payout approved before it was switched off.
5. **A "verified" answer from the bank could revive** an account that staff had just switched off or that had been replaced.
6. **Entry fees paid after a contest completed** stayed in customer funds forever. Such payments are now refunded.
7. **Large batches would have timed out** during approval. Settings are now read beforehand, with a longer time limit and a fixed lock order.
8. **One malformed settlement** would have stopped all later settlements from being booked.

**Also fixed:**
- Returns and refunds now take the same per-payee lock as payout approval.
- Two batches prepared at once can't both include a payee.
- Prizes are marked paid by the payout that carries them, not by timestamps.
- Credit notes copy the original invoice's lines.
- Home-visit invoices use the customer's state.
- Invoice prefixes differ by document type, so numbers can't collide under one GSTIN.
- The RazorpayX account number no longer appears in error messages.
- A zero minimum payout can't create empty payouts.
- An account whose bank name isn't the payee's is held before its first payout.

## 4. Known limitations

- **No finance screens in the dashboard yet.** Everything is available through the API. The screens are Phase 6c.
- **Apps don't show payouts, statements or invoices yet:** Phase 6d.
- **Invoices:**
  - No HSN codes, because products don't record them yet.
  - Late-cancellation and no-show charges get no invoice.
  - No credit note from PetApp when a month's returns exceed its fees.
  - Fees arriving late for a month that was already invoiced aren't billed.
- **Gateway chargebacks, disputes and adjustments** aren't booked.
- **TDS certificates** (Form 16A) and PAN collection for prize winners aren't built.
- **Rates need a tax adviser's check:** GST on entry fees, TDS on prizes and the commission SAC code are settings with sensible defaults.

## 5. Next: Phase 6c, finance screens in the dashboard

Overview, refunds, reconciliation issues, payout batches (prepare and approve), payout accounts, prizes, settlements, invoices, tax report and trial balance.
