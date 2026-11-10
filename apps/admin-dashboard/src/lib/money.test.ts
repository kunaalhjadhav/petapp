import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPaise, rupeesToPaise } from './money';

test('formats paise as Indian rupees', () => {
  assert.equal(formatPaise(10_000_00), '₹10,000');
  assert.equal(formatPaise(1_00_000_00), '₹1,00,000');
  assert.equal(formatPaise(199_50), '₹199.50');
  assert.equal(formatPaise(null), '—');
});

test('parses rupee input exactly, with no floating-point drift', () => {
  assert.equal(rupeesToPaise('199'), 19900);
  assert.equal(rupeesToPaise('₹1,999.5'), 199950);
  assert.equal(rupeesToPaise('0.29'), 29); // 0.29 * 100 in floats would be 28.999…
  assert.equal(rupeesToPaise('12.345'), null);
  assert.equal(rupeesToPaise('-5'), null);
  assert.equal(rupeesToPaise(''), null);
});
