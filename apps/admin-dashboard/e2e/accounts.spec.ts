import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';

/**
 * Phase 9e: staff passwords. Forgot password → the emailed link → a new password → signing in, then changing it
 * from Your account. Needs the API with EMAIL_PROVIDER=console: emails (and their links) are read from its log.
 */
const DB = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/petapp';
const API_LOG = process.env.API_LOG ?? '/tmp/api.log';
const tag = Date.now().toString(36);
const email = `pw-${tag}@staff.test`;
// A bcrypt hash of nothing anyone knows: the account can only get a password through the reset link.
const UNKNOWN = '$2a$12$syI6sWYOXIvV2klJGU.CKe48ZxCo/kSYhzRCS6LMD9fLCiXlH5pk6';

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    return (await db.query(q, params)).rows as T[];
  } finally {
    await db.end();
  }
}

async function resetLink(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const m = [...readFileSync(API_LOG, 'utf8').matchAll(new RegExp(`DEV EMAIL → ${email.replace('.', '\\.')}\\][\\s\\S]*?(http\\S+reset-password\\?token=[A-Za-z0-9_-]+)`, 'g'))];
    if (m.length) return m[m.length - 1][1];
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('no reset email in the API log (is EMAIL_PROVIDER=console?)');
}

/** The code an authenticator app shows now (RFC 6238: SHA-1, 6 digits, 30 seconds). */
function totp(base32: string, at = Date.now()): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of base32) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0');
}

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async () => {
  const [{ id }] = await sql<{ id: string }>(`INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt") VALUES (gen_random_uuid(), $1, 'Priya Test', $2, now()) RETURNING id`, [email, UNKNOWN]);
  await sql(`INSERT INTO "UserRole" ("userId", "roleId") SELECT $1, id FROM "Role" WHERE key = 'SUPPORT_AGENT'`, [id]);
});

test.afterAll(async () => {
  await sql(`DELETE FROM "User" WHERE email = $1`, [email]);
});

test('forgot password: an emailed link sets a new one, then it can be changed in Your account', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('status')).toContainText('If that email belongs to a staff account');

  const link = new URL(await resetLink());
  await page.goto(link.pathname + link.search);
  await expect(page.getByText(/For p•••@staff\.test/)).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('password1234');
  await page.getByLabel('New password again').fill('password1234');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByText(/too common/)).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('silver otter harbour 31');
  await page.getByLabel('New password again').fill('silver otter harbour 31');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByRole('status')).toContainText('Password set.');

  // The link is used up.
  await page.goto(link.pathname + link.search);
  await expect(page.getByText('This link has expired or was already used.')).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('silver otter harbour 31');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('You’re still using the password you were given.')).toHaveCount(0);

  await page.goto('/account');
  await page.getByLabel('Current password').fill('wrong password here');
  await page.getByLabel('New password', { exact: true }).fill('copper finch valley 58');
  await page.getByLabel('New password again').fill('copper finch valley 58');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Your current password isn’t right.')).toBeVisible();
  await page.getByLabel('Current password').fill('silver otter harbour 31');
  await page.getByLabel('New password', { exact: true }).fill('copper finch valley 58');
  await page.getByLabel('New password again').fill('copper finch valley 58');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. You’ve been signed out everywhere else.')).toBeVisible();
  // Still signed in here.
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
});

test('two-factor sign-in: set up with an authenticator app, sign in with a recovery code, then a code', async ({ page }) => {
  const password = 'copper finch valley 58';
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/account');
  await page.getByRole('button', { name: 'Set up two-factor sign-in' }).click();
  await page.getByLabel('Your password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const secret = (await page.getByTestId('mfa-secret').textContent())!.trim();
  await page.getByLabel('2. Enter the 6-digit code it shows').fill('000000');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(/That code isn’t right/)).toBeVisible();
  await page.getByLabel('2. Enter the 6-digit code it shows').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  const codes = await page.getByTestId('recovery-codes').locator('li').allTextContents();
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'I’ve saved them' }).click();
  await expect(page.getByText(/On since .+\. 10 recovery codes left\./)).toBeVisible();

  // Signing in now takes a code: first a recovery code (as if the phone were lost).
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText(/That code isn’t right/)).toBeVisible();
  await page.getByLabel('Code').fill(codes[0]);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account');
  await expect(page.getByText(/9 recovery codes left/)).toBeVisible();

  // Then with the app. (A code works once: move the last accepted step back, as if 30 seconds had passed.)
  await sql(`UPDATE "User" SET "mfaLastStep" = "mfaLastStep" - 2 WHERE email = $1`, [email]);
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/$/);

  // And off again.
  await sql(`UPDATE "User" SET "mfaLastStep" = "mfaLastStep" - 2 WHERE email = $1`, [email]);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Turn off' }).click();
  await page.getByLabel('Your password').fill(password);
  await page.getByLabel('Code from your authenticator app').fill(totp(secret));
  await page.locator('form').getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('button', { name: 'Set up two-factor sign-in' })).toBeVisible();
});
