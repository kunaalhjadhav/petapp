# Phase 6c — Finance screens in the admin dashboard: report

## 1. Implemented

A new **Finance** menu in the dashboard:
- **Who sees it:** staff with `finance.read`, which means the Finance role or a super admin.
- **Who can act:** buttons that move or record money need `finance.manage`.
- **Safety:** the API checks every permission again, so a hidden button is a convenience, not the protection.

| Screen | What finance staff can do |
|---|---|
| **Money overview** | **Right now:** money held by the gateway, customer money held, refunds owed, what's owed to sellers and partners, and GST, TCS and TDS to pay. **Over a chosen period** (India time): money collected, refunds, fees, taxes and discounts. **Refunds** by status. **The last reconciliation.** Red banners appear when money is at risk or refunds have failed. |
| **Refunds** | **Tabs:** failed, waiting, with the gateway, refunded, paid another way. **Each refund shows:** the customer, the reason, the payment, attempts and the last error. **Send again:** puts a failed refund back in the queue. The gateway is checked first, so it can't be paid twice. **Paid another way:** records a refund paid by bank transfer, with its reference. |
| **Reconciliation** | **Run now.** **Recent runs** with what each found and repaired. **Open and resolved issues,** filtered by "money at risk" or "needs a look". **Mark resolved:** records a note of what was done; that finding isn't raised again. **Recover payment:** for a payment the gateway took but PetApp never confirmed. It asks the gateway, then completes the payment. |
| **Payouts** | **Due now:** who is due and how much, by payee type. **Batches:** prepare one, with an optional note for the approver. **Batch page:** each payee, the account (last 4 digits or UPI ID), the amount, the status and the bank reference. **Totals:** paid, on its way and not paid. **Approve and pay:** shown only to someone other than the person who prepared the batch; that person sees "someone else must approve it". **Cancel:** for a batch not yet approved. **The record** names who prepared and who approved each batch. |
| **Payout accounts** | **Filters:** by status and by payee type. **Each account shows:** the name at the bank, a warning when it doesn't match the name entered, the safety-hold end time, and why the bank refused it. **Switch off:** records a reason in the audit log. Nothing more is sent to the account, including payouts already approved. |
| **Prizes** | **Lists:** cash prizes waiting for approval, approved, and paid, with a warning when the winner has no payout account yet. **Approve:** deducts TDS where it applies and pays the rest in the next batch. |
| **Settlements** | **Lists:** gateway transfers to the bank, their fees and the GST in those fees, with totals. **Fetch now.** |
| **Invoices** | **Lists:** customer invoices, credit notes and PetApp's commission invoices. **PDF download.** **Issue commission invoices:** for a finished month (defaults to last month). |
| **Tax report** | **By month:** TCS and TDS by payee, with GSTIN and PAN (a missing PAN is flagged). **Download CSV.** |
| **Ledger** | **Trial balance:** now, or at the end of any day, with a "Balanced" check. **Accounts:** PetApp's own, plus sellers, partners and winners grouped with subtotals. **Download CSV.** **Drill-down:** open an account to see every posting, then open a posting to see all its lines. |

**Details:**
- **Downloads:** PDFs and spreadsheets pass through the dashboard's own server. The browser never holds the API token, and nothing is cached.
- **Spreadsheets:** amounts are exact rupees with no rounding. A cell that starts like a formula is defused, so a name such as `=HYPERLINK(…)` can't run in Excel.
- **Amounts:** shown with even digits and right-aligned, with negatives in red.
- **Labels:** every status, reason, issue type and posting type is in plain words. Anything new falls back to readable text.
- **Navigation:** the "Money overview" menu item is highlighted only on its own page.
- **API change:** batches now return who prepared and who approved them, for the maker-checker record.

## 2. Verification

| Check | Result |
|---|---|
| Browser end-to-end (Playwright) | **16 passed**, including 2 new finance tests (details below). All earlier dashboard tests still pass. |
| Dashboard unit tests | **16 passed.** New: India-time months at the midnight boundary, input checks, labels, links, account masking, exact rupee amounts, CSV quoting and formula defusing. |
| API end-to-end | **122 passed** in 9 suites. The payouts suite now also checks that a batch names both people. |
| API unit tests | **132 passed** |
| Lint, types, production build | Clean (dashboard and API) |
| Visual check | Overview, payouts, reconciliation, ledger and payout accounts screenshotted at desktop size; layout as intended. |

**The 2 new finance tests:**
- **Payout batch:** a seller is due ₹500. One admin prepares the batch and can't approve it. A second person with only the Finance role signs in separately and approves it. The worker pays it and the bank reference appears. The seller's ledger account shows the posting, the books still balance, and the account is then switched off with a reason.
- **Other screens:**
  - **Reconciliation:** run on demand.
  - **Settlements:** fetched.
  - **Commission invoices:** issued for last month.
  - **Downloads:** an invoice PDF, the tax-report CSV and the trial-balance CSV.
  - **Bad links:** an invalid invoice link returns "not found".

## 3. Problems found and fixed

- **The dev database had no Finance role,** because it hadn't been seeded since Phase 6b. Running the seed again fixes it. The README now says to do this when upgrading.
- **Batches showed only user IDs for who prepared and approved them.** The API now returns their names.
- **Repaired postings were counted twice** in a run's summary ("22 postings repaired, 22 missing ledger postings"). Now shown once.
- **Two form labels clashed with their fields** for screen readers ("Month" form, "Month" field). The forms are now named "Choose a month", "Choose a date" and "Choose a period".
- **Amount headings were left-aligned over right-aligned figures.** Tables can now right-align chosen columns.

## 4. Known limitations

- **Refunds and prizes in the browser tests:** only their screens are checked, not their actions. The actions are covered by the API's end-to-end tests. Setting up a failed refund in the browser tests would mean faking gateway history.
- **Prizes list** shows the latest 200 per status, with no paging.
- **Settlements list** shows the latest 50.
- **No date filter** on refunds, invoices or the ledger account pages yet. They page newest first.
- **Tax report and trial balance CSVs** are for spreadsheets. They are not in the GSTR-8 / 26Q upload formats; that needs a tax adviser's input.
- **From Phase 6b,** these are still open: HSN codes, invoices for late-cancellation and no-show charges, chargebacks, TDS certificates, and PAN collection for prize winners.

## 5. Next: Phase 6d, money in the apps

- **Seller and partner apps:** statement, payouts, payout account and invoices.
- **Customer app:** refund status and invoices.
- **Prize winners:** add a payout account.
