import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { openDialog } from './helpers';

/** Phase 9d: analytics (spec §55), membership plans and members (spec §40), and promotions (spec §36). */
const DB = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/petapp';
const tag = Date.now().toString(36);

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    return (await db.query(q, params)).rows as T[];
  } finally {
    await db.end();
  }
}

test.afterAll(async () => {
  await sql(`DELETE FROM "Membership" WHERE note LIKE $1`, [`%${tag}%`]);
  await sql(`DELETE FROM "MembershipPlan" WHERE key = $1`, [`TEST_${tag.toUpperCase()}`]);
  await sql(`DELETE FROM "Promotion" WHERE title LIKE $1`, [`%${tag}`]);
});

test('analytics: each report, a date range and the CSV', async ({ page }) => {
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.locator('[data-kpi="dau"]')).toContainText('Daily active users');
  await expect(page.getByRole('img', { name: /Daily active users, daily/ })).toBeVisible();
  for (const [tab, figure] of [['Reels', 'Completion rate'], ['Contests', 'Registrations'], ['Shop', 'Average order value'], ['Services', 'Cancellation rate']]) {
    await page.getByRole('navigation', { name: 'Report' }).getByRole('link', { name: tab, exact: true }).click();
    await expect(page.locator('[data-kpi]').filter({ hasText: figure }).first()).toBeVisible();
  }
  await page.getByRole('link', { name: 'Last 7 days' }).click();
  await expect(page.getByText(/\(7 days\)/)).toBeVisible();
  await page.getByLabel('From', { exact: true }).fill('2026-10-10');
  await page.getByLabel('To', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByText('The start date is after the end date.')).toBeVisible();

  await page.goto('/analytics?tab=services');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^petapp-analytics-services-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('memberships: add a plan, give a membership and end it', async ({ page }) => {
  await page.goto('/memberships');
  await expect(page.getByRole('cell', { name: /Premium/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Add plan' }).click();
  let d = openDialog(page);
  await d.getByLabel('Key').fill(`TEST_${tag.toUpperCase()}`);
  await d.getByLabel('Name').fill(`Test plan ${tag}`);
  await d.getByLabel('Price (₹)').fill('99');
  await d.getByLabel('Member badge on the profile').check();
  await d.getByRole('button', { name: 'Add plan' }).click();
  const row = page.getByRole('row').filter({ hasText: `Test plan ${tag}` });
  await expect(row).toContainText('₹99');
  await expect(row).toContainText('Member badge on your profile');

  const [user] = await sql<{ id: string; name: string }>(`SELECT u.id, u.name FROM "User" u WHERE u.phone IS NOT NULL AND u.status = 'ACTIVE' AND u.name IS NOT NULL ORDER BY u."createdAt" LIMIT 1`);
  await page.goto('/memberships/members');
  await page.getByRole('button', { name: 'Give a membership' }).click();
  d = openDialog(page);
  await d.getByLabel('Person’s user ID').fill(user.id);
  await d.getByLabel('Plan').selectOption({ label: `Test plan ${tag}` });
  await d.getByLabel('Reason').fill(`Playwright ${tag}`);
  await d.getByRole('button', { name: 'Give' }).click();
  await expect(page.getByText('Membership given.')).toBeVisible();
  const member = page.getByRole('row').filter({ hasText: `Playwright ${tag}` });
  await expect(member).toContainText('Current');
  await member.getByRole('button', { name: 'End' }).click();
  d = openDialog(page);
  await d.getByLabel('Reason').fill(`Done ${tag}`);
  await d.getByRole('button', { name: 'End membership' }).click();
  await expect(page.getByRole('row').filter({ hasText: `Done ${tag}` })).toContainText('Ended by staff');
});

test('promotions: queue one for later, then cancel it', async ({ page }) => {
  await page.goto('/promotions');
  await expect(page.getByText('Can be reached now')).toBeVisible();
  await page.getByRole('button', { name: 'New promotion' }).click();
  const d = openDialog(page);
  await d.getByLabel('Title').fill(`Weekend treats ${tag}`);
  await d.getByLabel('Message').fill('Free delivery on treats this weekend.');
  await d.getByLabel('Opens (optional)').fill('https://example.com');
  await d.getByLabel('Send at (India time, optional)').fill('2030-01-01T10:00');
  await d.getByRole('button', { name: 'Queue it' }).click();
  await expect(d.getByText(/page in the app/)).toBeVisible();
  await d.getByLabel('Opens (optional)').fill('/shop');
  await d.getByRole('button', { name: 'Queue it' }).click();
  await expect(d.getByText(/at most 30 days ahead/)).toBeVisible();
  const soon = new Date(Date.now() + 330 * 60_000 + 2 * 86_400_000).toISOString().slice(0, 16);
  await d.getByLabel('Send at (India time, optional)').fill(soon);
  await d.getByRole('button', { name: 'Queue it' }).click();
  const row = page.getByRole('row').filter({ hasText: `Weekend treats ${tag}` });
  await expect(row).toContainText('Scheduled');
  await row.getByRole('button', { name: 'Cancel' }).click();
  await openDialog(page).getByRole('button', { name: 'Cancel it' }).click();
  await expect(row).toContainText('Cancelled');
});
