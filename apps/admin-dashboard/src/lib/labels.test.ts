import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bpsToPct, minutesToTime, stars, targetPlural } from './labels';

test('opening hours read naturally', () => {
  assert.equal(minutesToTime(0), '12:00 am');
  assert.equal(minutesToTime(9 * 60), '9:00 am');
  assert.equal(minutesToTime(12 * 60 + 30), '12:30 pm');
  assert.equal(minutesToTime(20 * 60), '8:00 pm');
  assert.equal(minutesToTime(24 * 60), '12:00 am');
});

test('commission in basis points', () => {
  assert.equal(bpsToPct(1500), '15%');
  assert.equal(bpsToPct(1250), '12.50%');
});

test('report types and stars read naturally', () => {
  assert.equal(targetPlural('PRODUCT_REVIEW'), 'Product reviews');
  assert.equal(targetPlural('USER'), 'People');
  assert.equal(targetPlural('SERVICE_PARTNER'), 'Service businesses');
  assert.equal(stars(4), '★★★★☆');
  assert.equal(stars(9), '★★★★★');
});
