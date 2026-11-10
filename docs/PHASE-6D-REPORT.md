# Phase 6d — Money in the apps: report

## 1. Implemented

### Seller app and partner app
The **Earnings** tab is now **Money**:
- **Ready to be paid:** the payable amount, plus what is still in the return window (sellers) or holding period (partners).
- **Where it's paid:** the account, and the safety-hold end time when it's new.
- **Recent payouts:** status in plain words (paid, on its way, not paid: back on your balance, returned by the bank), the bank reference (UTR) and any reason it wasn't paid.
- **Statement:**
  - **Totals:** earned, paid out, owed now, PetApp's fees, TCS and TDS, with a note that TCS and TDS can be claimed when filing returns.
  - **Lines:** every sale or visit with its price, fee and taxes; every return and payout.
- **Invoices:** tax invoices issued to customers in the payee's name, credit notes for returns, and PetApp's monthly fee invoices. Tapping one opens the PDF in the phone's browser.
- **Payout account** (also on the Store / Business screen):
  - **Add or change:** a bank account (IFSC, account number typed twice) or a UPI ID.
  - **Checked before sending:** the same rules as the API.
  - **Bank response:** the bank's check runs straight away. The screen shows the name the bank has, why a refused account was refused, a warning when the bank's name isn't one of the payee's own, and when a new account's safety hold ends.
  - **Privacy:** only the last 4 digits are ever shown.
- **Freshness:** money refreshes after order and booking actions.

### Customer app
A wallet icon on the profile opens **Payments and refunds**:
- **Refunds:**
  - **What each was for:** "Order PO-…", "Full groom (PB-…)", a contest or challenge. Tapping opens it.
  - **Status in plain words:** on its way, refunded, delayed (our team is on it), or paid back by bank transfer, plus what happens next.
  - **Reference:** the refund reference the customer's bank can look up.
- **Invoices:** bills for orders and bookings, opened as PDFs.
- **Prize money** for contest winners:
  - **Owed:** what's owed after TDS.
  - **Each prize:** with its TDS, and a note on claiming it.
  - **Account:** the payout account (UPI first, bank optional).
  - **Payouts:** with their bank reference.
- **Notifications:** refund notices for contest or challenge entries, prize payouts and payout-account checks now open these screens.

### API additions
- **`GET /me/refunds`:** the customer's refunds, paged, each with what it was for.
- **`GET /me/statement`:** a prize winner's statement (prizes with TDS, and payouts).
- **`POST /invoices/{id}/link` and `GET /invoices/{id}/file`:** the phone's browser can't send the app's sign-in token, so the app asks for a link instead.
  - **Scope:** the link is signed for that one invoice and works for 5 minutes.
  - **Access:** only the invoice's customer or its seller/partner can get one.
  - **Rejected links:** an altered, expired or reused-for-another-invoice link gets "not found".
  - **Signing key:** derived from the server secret, never the secret itself.
- **Statement totals now separate earnings from payouts.** Before, "earned" fell to ₹0 once the money was paid out, because the payout was netted against it. Payout lines no longer show a misleading "sale" amount.
- **Payee name check:** the "name matches" flag now uses the same test as the safety hold: the bank's name is one of the payee's own (business, legal or personal). Before, a UPI ID the bank had in the business's name showed a false warning. This also affects the dashboard's payout accounts screen.
- **Earnings note:** the "Payouts are coming soon" note on earnings now describes how payouts work.

## 2. Verification

| Check | Result |
|---|---|
| API end-to-end | **123 passed.** New: the customer's refunds list (and nobody else's), invoice download links (owner only, tampered or swapped links refused, a missing signature refused), statement totals after a payout, and a bank name matching another of the payee's names |
| API unit | **135 passed.** New: link signing (expiry boundary, another invoice, another key, an edited expiry, a far-future expiry, malformed input) |
| Dashboard | Lint, types and 16 unit tests clean |
| Real API responses for the apps | `scripts/record_money_fixtures.py` ran the whole journey against the running API and worker. **A seller:** a delivered parcel and a cancelled one, a refused bank account then a good one, paid in a batch approved by a second finance person. **A partner:** a completed visit and a cancelled one, a UPI ID, paid, then a replacement account on hold. **A customer:** both refunds and both invoices. **A contest winner:** a ₹15,000 prize, ₹4,500 TDS, ₹10,500 paid to UPI. 26 responses saved as fixtures across the three apps |
| App ↔ API contract | All three apps pass: every endpoint exists, and every JSON field the new models read appears in those real responses. Also checked that a wrong field name is caught |
| Dart tests | New model and helper tests in all three apps. Their expectations were also run in Python against the same fixtures (`scripts/check_money_mirrors.py`), all passing. The script also checks that the apps' IFSC, account-number and UPI rules are identical to the API's |
| Dart structure | Bracket balance clean. New `scripts/dart_names_check.py` checks every import exists and no name is visible from two places; all three apps pass. Also checked that a planted clash is caught |

**What couldn't be run here:** Flutter itself isn't available, so the apps weren't compiled and `flutter test` wasn't run. The checks above are stand-ins. Run `flutter analyze` and `flutter test` in each app before release.

## 3. Problems found and fixed

1. **Statements said "earned ₹0" after a payout,** because payouts were netted into the earned total. Earnings and payouts are now separate totals.
2. **False "not your name" warning** for a UPI ID that the bank holds in the business's name. No hold was applied, but the flag disagreed with the hold rule. They now use the same test.
3. **Invoice PDFs couldn't be opened from the apps:** the API needs a sign-in token that a browser can't send. This is fixed with signed, short-lived download links, and no new phone permissions or plugins in the seller and partner apps.
4. **The partner and customer apps couldn't page through lists that report their page numbers** (statements, invoices, refunds). Paging was added to their API clients.
5. **The "Payouts are coming soon" note** was still shown on earnings.

## 4. Known limitations

- **Not compiled here:** the apps couldn't be compiled or tested with Flutter in this environment (see §2).
- **Customer app dependency:** it now uses `url_launcher` to open PDFs. Run `flutter pub get`, and add the `<queries>` lines in its README for Android 11+.
- **Payout history:** apps show the latest 20 payouts; the statement has the full history.
- **No in-app download:** invoices open in the browser rather than downloading inside the app.
- **No TDS certificates (Form 16A) or PAN entry** for prize winners yet.
- **Refunds paid by bank transfer:** they show the reference staff entered. The customer isn't asked for bank details in the app; support arranges this.

## 5. Next: Phase 7, AI

AI moderation assist (never the final decision), recommendations, the PetApp Assistant with vet-advice guardrails, and fraud scoring.
