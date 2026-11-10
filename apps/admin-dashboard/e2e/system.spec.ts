import { expect, test } from '@playwright/test';

test('system health: dependencies, connected services, money and background jobs', async ({
  page,
}) => {
  await page.goto('/system');
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
  const deps = page.locator('section', {
    has: page.getByRole('heading', { name: 'Dependencies' }),
  });
  await expect(deps).toContainText('Database');
  await expect(deps.getByText('OK').first()).toBeVisible();
  await expect(
    page.locator('section', { has: page.getByRole('heading', { name: 'Connected services' }) }),
  ).toContainText('Payments');
  await expect(page.getByRole('link', { name: 'Refunds that failed (7 days)' })).toBeVisible();
  const jobs = page.locator('section', {
    has: page.getByRole('heading', { name: 'Background jobs' }),
  });
  for (const q of ['Photos and videos', 'Notifications', 'AI moderation and account risk'])
    await expect(jobs).toContainText(q);
});
