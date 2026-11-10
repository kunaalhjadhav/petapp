import { base32Decode, base32Encode, hashRecoveryCode, hotp, looksLikeRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from './totp.rules';

// RFC 6238 appendix B: the SHA-1 secret is ASCII "12345678901234567890"; 8-digit codes.
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    const cases: Array<[number, string]> = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
    for (const [t, code] of cases) expect(hotp(RFC_SECRET, Math.floor(t / 30), 8)).toBe(code);
  });

  it('round-trips base32', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(() => base32Decode('1!')).toThrow();
  });

  it('accepts the current code and one step either side, nothing else', () => {
    const secret = base32Encode(RFC_SECRET);
    const at = 1_700_000_000_000;
    const step = Math.floor(at / 30_000);
    const code = (s: number) => hotp(RFC_SECRET, s);
    expect(verifyTotp(secret, code(step), at)).toBe(step);
    expect(verifyTotp(secret, code(step - 1), at)).toBe(step - 1);
    expect(verifyTotp(secret, code(step + 1), at)).toBe(step + 1);
    expect(verifyTotp(secret, code(step - 2), at)).toBeNull();
    expect(verifyTotp(secret, '12345', at)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', at)).toBeNull();
    expect(verifyTotp(secret, `${code(step).slice(0, 3)} ${code(step).slice(3)}`, at)).toBe(step);
  });

  it('builds the authenticator link and recovery codes', () => {
    expect(otpauthUrl('ABC', 'asha@petapp.in')).toBe('otpauth://totp/PetApp%20Admin%3Aasha%40petapp.in?secret=ABC&issuer=PetApp%20Admin&algorithm=SHA1&digits=6&period=30');
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes.map((c) => c.code)).size).toBe(10);
    expect(codes[0].code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(hashRecoveryCode(codes[0].code.toUpperCase().replace(/-/g, ' '))).toBe(codes[0].hash);
    expect(looksLikeRecoveryCode(codes[0].code)).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
});
