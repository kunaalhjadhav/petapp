import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAction, formatAge, formatPhone, humanize, initials, timeAgo } from './format';
import { secondsUntilExpiry } from './session';

test('formatPhone groups Indian numbers and leaves others alone', () => {
  assert.equal(formatPhone('+919812345678'), '+91 98123 45678');
  assert.equal(formatPhone('+14155552671'), '+14155552671');
  assert.equal(formatPhone(null), '—');
});

test('timeAgo', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(timeAgo('2026-10-01T11:59:40Z', now), 'just now');
  assert.equal(timeAgo('2026-10-01T11:55:00Z', now), '5 min ago');
  assert.equal(timeAgo('2026-10-01T09:00:00Z', now), '3 h ago');
  assert.equal(timeAgo('2026-09-30T12:00:00Z', now), '1 day ago');
  assert.equal(timeAgo(null, now), 'never');
  assert.match(timeAgo('2026-08-01T00:00:00Z', now), /2026/);
});

test('formatAge', () => {
  assert.equal(formatAge(null), '—');
  assert.equal(formatAge(1), '1 month');
  assert.equal(formatAge(37), '3 yr 1 mo');
  assert.equal(formatAge(24), '2 yrs');
});

test('humanize, describeAction, initials', () => {
  assert.equal(humanize('SUPPORT_AGENT'), 'Support agent');
  assert.equal(describeAction('user.status'), 'Changed account status');
  assert.equal(describeAction('something.new'), 'Something new');
  assert.equal(initials('Aanya Kapoor'), 'AK');
  assert.equal(initials('Dr. Arjun Rao'), 'AR');
  assert.equal(initials(null), '?');
});

test('secondsUntilExpiry reads the JWT exp claim', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1_000_100 })).toString('base64url');
  assert.equal(secondsUntilExpiry(`h.${payload}.s`, 1_000_000_000), 100);
  assert.equal(secondsUntilExpiry(undefined), null);
  assert.equal(secondsUntilExpiry('garbage'), null);
});
