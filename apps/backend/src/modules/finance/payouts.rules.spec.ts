import { namesMatch, payoutMode, prizeTds } from './finance.rules';
import { SecretBox } from './secret-box';

describe('payout rules', () => {
  it('picks the transfer mode', () => {
    expect(payoutMode('BANK', 5_00_000_00)).toBe('IMPS');
    expect(payoutMode('BANK', 5_00_000_01)).toBe('NEFT');
    expect(payoutMode('UPI', 100)).toBe('UPI');
  });

  it('matches names the way bank records differ', () => {
    expect(namesMatch('Meera  Sharma.', 'MEERA SHARMA')).toBe(true);
    expect(namesMatch('Mr. Rahul Kumar', 'RAHUL KUMAR')).toBe(true);
    expect(namesMatch('Rahul Kumar', 'Rahul Kumari')).toBe(false);
    expect(namesMatch(null, 'X')).toBe(false);
  });

  it('deducts TDS only on prizes above the threshold', () => {
    expect(prizeTds(10_000_00, 3000, 10_000_00)).toBe(0);
    expect(prizeTds(10_000_01, 3000, 10_000_00)).toBe(3_00_000);
    expect(prizeTds(25_000_00, 3000, 10_000_00)).toBe(7_500_00);
  });

  it('encrypts account numbers so only the key can read them, and detects tampering', () => {
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'));
    const sealed = box.seal('50100123456789');
    expect(sealed).not.toContain('50100123456789');
    expect(sealed).not.toBe(box.seal('50100123456789')); // random IV
    expect(box.open(sealed)).toBe('50100123456789');
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered!').toString('base64');
    expect(() => box.open(parts.join(':'))).toThrow();
    expect(() => new SecretBox(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => new SecretBox(Buffer.alloc(32, 9).toString('base64')).open(sealed)).toThrow();
  });
});
