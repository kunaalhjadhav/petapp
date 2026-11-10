// Time-based one-time passwords (RFC 6238, as authenticator apps use: SHA-1, 6 digits, 30 seconds) and recovery
// codes, for staff two-factor sign-in (Phase 10a). Pure; unit-tested against the RFC's test vectors.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (what authenticator apps take). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** The code for a time step (HOTP, RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = 6, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algorithm, secret).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

export const timeStep = (at: number = Date.now(), period = 30) => Math.floor(at / 1000 / period);

/**
 * Checks a code, allowing one step either side for clock drift. Returns the step it matched (so it can't be used
 * again), or null.
 */
export function verifyTotp(base32Secret: string, code: string, at: number = Date.now()): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(base32Secret);
  const now = timeStep(at);
  for (const step of [now, now - 1, now + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

/** The link authenticator apps read from a QR code. */
export function otpauthUrl(base32Secret: string, account: string, issuer = 'PetApp Admin'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Ten one-time recovery codes like "k7qp-2mxd-9tfw", and the hashes that are stored. */
export function newRecoveryCodes(n = 10): Array<{ code: string; hash: string }> {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(12);
    const raw = Array.from(b, (x) => chars[x % chars.length]).join('');
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    return { code, hash: hashRecoveryCode(code) };
  });
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashRecoveryCode = (code: string) => createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
export const looksLikeRecoveryCode = (code: string) => normalizeRecoveryCode(code).length === 12;
