import { expect, type Page } from '@playwright/test';

export const ADMIN_EMAIL =
  process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? 'admin@petapp.local';
export const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? '';

export async function signIn(page: Page, next = '/') {
  expect(ADMIN_PASSWORD, 'Set E2E_ADMIN_PASSWORD (or SEED_ADMIN_PASSWORD)').not.toBe('');
  await page.goto(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Work email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(next === '/' ? /\/$/ : new RegExp(`${next.replace('?', '\\?')}$`));
}

/** The open dialog (pages contain several closed ones). */
export const openDialog = (page: Page) => page.locator('dialog[open]');
