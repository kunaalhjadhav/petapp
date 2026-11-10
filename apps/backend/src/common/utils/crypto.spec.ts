import { hmac, numericCode, randomToken, safeEqualHex } from './crypto';
import { handleCandidate, slugify } from './slug';

describe('crypto utils', () => {
  it('numericCode has fixed length and digits only', () => {
    for (let i = 0; i < 200; i++) expect(numericCode(6)).toMatch(/^\d{6}$/);
  });
  it('safeEqualHex compares correctly and tolerates length mismatch', () => {
    const a = hmac('k', 'x');
    expect(safeEqualHex(a, hmac('k', 'x'))).toBe(true);
    expect(safeEqualHex(a, hmac('k', 'y'))).toBe(false);
    expect(safeEqualHex(a, 'ab')).toBe(false);
  });
  it('randomToken is url-safe and unique', () => {
    const t = randomToken();
    expect(t).toMatch(/^[\w-]+$/);
    expect(t).not.toBe(randomToken());
  });
});

describe('slug', () => {
  it('slugifies names', () => expect(slugify('Mr. Fluffy Paws!')).toBe('mr.fluffy.paws'));
  it('falls back to "pet" for empty names', () => expect(handleCandidate('!!!')).toMatch(/^pet\.[0-9a-f]{6}$/));
});
