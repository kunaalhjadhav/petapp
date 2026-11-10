import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUE_KIND,
  TX_KIND,
  accountHref,
  describeAccount,
  isDay,
  isMonth,
  istToday,
  label,
  lastMonth,
  monthName,
  paymentIdOf,
  referenceHref,
  rupees,
  thisMonth,
  toCsv,
} from './finance';

const ID = '3f0c8a52-1b7e-4d2a-9c11-0a9b8c7d6e5f';

test('India-time dates: today, this month and last month turn over at IST midnight', () => {
  // 31 March 2026, 18:29 UTC = 23:59 IST; 18:31 UTC = 00:01 IST on 1 April.
  const before = Date.UTC(2026, 2, 31, 18, 29);
  const after = Date.UTC(2026, 2, 31, 18, 31);
  assert.equal(istToday(before), '2026-03-31');
  assert.equal(istToday(after), '2026-04-01');
  assert.equal(thisMonth(before), '2026-03');
  assert.equal(lastMonth(after), '2026-03');
  assert.equal(lastMonth(Date.UTC(2026, 0, 15)), '2025-12');
});

test('month names and input validation', () => {
  assert.equal(monthName('2026-09'), 'September 2026');
  assert.ok(isMonth('2026-10'));
  assert.ok(!isMonth('2026-13'));
  assert.ok(!isMonth('2026-1'));
  assert.ok(!isMonth(undefined));
  assert.ok(isDay('2026-10-31'));
  assert.ok(!isDay('2026-10-3'));
  assert.ok(!isDay('31-10-2026'));
});

test('labels fall back to readable text for kinds the dashboard does not know yet', () => {
  assert.equal(label(TX_KIND, 'PAYMENT_CAPTURED'), 'Payment received');
  assert.equal(
    label(ISSUE_KIND, 'MISSED_CAPTURE'),
    'Payment the gateway took but we never confirmed',
  );
  assert.equal(label(TX_KIND, 'SOMETHING_NEW'), 'Something new');
  assert.equal(label(TX_KIND, null), '—');
});

test('references link to the right screen, and only for known kinds', () => {
  assert.equal(referenceHref(`VENDOR:${ID}`), `/shop/vendors/${ID}`);
  assert.equal(referenceHref(`PARTNER:${ID}`), `/partners/${ID}`);
  assert.equal(referenceHref(`Contest:${ID}`), `/contests/${ID}`);
  assert.equal(referenceHref(`PayoutBatch:${ID}`), `/finance/payouts/${ID}`);
  assert.equal(referenceHref(`SubOrder:${ID}`), null);
  assert.equal(referenceHref('control:gateway'), null);
  assert.equal(referenceHref(null), null);
  assert.equal(paymentIdOf(`Payment:${ID}`), ID);
  assert.equal(paymentIdOf(`Payment:${ID}:extra`), null);
  assert.equal(accountHref(`VENDOR:${ID}`), `/finance/ledger/VENDOR%3A${ID}`);
});

test('accounts are described without full numbers', () => {
  assert.equal(
    describeAccount({ method: 'BANK', accountLast4: '6789', ifsc: 'HDFC0001234', vpa: null }),
    'Bank •••• 6789 · HDFC0001234',
  );
  assert.equal(
    describeAccount({ method: 'UPI', accountLast4: null, ifsc: null, vpa: 'meera@okhdfcbank' }),
    'meera@okhdfcbank',
  );
});

test('rupee amounts for spreadsheets are exact', () => {
  assert.equal(rupees(12345), '123.45');
  assert.equal(rupees(5), '0.05');
  assert.equal(rupees(-5), '-0.05');
  assert.equal(rupees(0), '0.00');
  assert.equal(rupees(1_00_000_00), '100000.00');
});

test('CSV quotes every field and defuses spreadsheet formulas, but not negative amounts', () => {
  const csv = toCsv([
    ['Name', 'Amount'],
    ['=HYPERLINK("x")', '-0.05'],
    ['Paws "Mart", Pune', 12],
    [null, '@SUM(A1)'],
  ]);
  assert.equal(
    csv,
    [
      '"Name","Amount"',
      `"'=HYPERLINK(""x"")","-0.05"`,
      '"Paws ""Mart"", Pune","12"',
      `"","'@SUM(A1)"`,
      '',
    ].join('\r\n'),
  );
});
