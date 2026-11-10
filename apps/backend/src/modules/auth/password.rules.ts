// Staff password rules and reset tokens (Phase 9e). Pure; unit-tested.
import { createHash, randomBytes } from 'crypto';

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

/** Very common passwords and patterns (lower-case, compared without spaces). Long enough isn't enough. */
const COMMON = new Set([
  'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'password123', 'password1234', 'qwerty', 'qwertyuiop', 'qwerty123', 'qwerty123456',
  'letmein', 'welcome', 'welcome123', 'admin', 'admin123', 'administrator', 'changeme', 'iloveyou', 'abc123', 'abcdef', 'abcdefgh',
  'abcdefghijkl', '123456', '1234567890', '123456789012', '111111111111', '000000000000', 'petapp', 'petapp123', 'petappadmin', 'india123',
]);

/**
 * What's wrong with a new staff password, or null. Rules: 12 to 128 characters; not mostly one character; not a
 * common password (with or without a year or digits at the end); not built on the person's email or name; and,
 * when given, not the password they were given (changeme-style seeds) or the current one.
 */
export function passwordProblem(password: string, about: { email?: string | null; name?: string | null } = {}): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters. A short phrase of four or five words is easy to remember.`;
  if (password.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  if (password.trim() !== password) return 'The password can’t start or end with a space.';
  const lower = password.toLowerCase().replace(/\s+/g, '');
  if (new Set(lower).size < 5) return 'Use more different characters.';
  const stem = lower.replace(/[\d!@#$%^&*._-]+$/, '');
  if (COMMON.has(lower) || COMMON.has(stem) || /^changeme/.test(lower)) return 'That password is too common. Choose something only you would think of.';
  if (/^(.{1,6})\1+$/.test(lower)) return 'Avoid repeating patterns.';
  const local = about.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'Don’t use your email address in your password.';
  for (const part of (about.name ?? '').toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) return 'Don’t use your name in your password.';
  }
  return null;
}

/** A reset token for a link (URL-safe, 256 bits) and the hash that's stored. */
export function newResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashResetToken(token) };
}

export const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Shape of a token in a link: anything else is refused before touching the database. */
export const RESET_TOKEN = /^[A-Za-z0-9_-]{43}$/;
