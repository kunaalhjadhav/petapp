import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
export const hmac = (secret: string, v: string): string => createHmac('sha256', secret).update(v).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function numericCode(length: number): string {
  return randomInt(0, 10 ** length).toString().padStart(length, '0');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
