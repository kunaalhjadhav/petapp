import { expect, test } from '@playwright/test';

test('on a phone, content comes first and the menu opens on demand', async ({ page }) => {
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'People' })).toBeInViewport();
  await page.getByText('Menu', { exact: true }).click();
  await page.locator('details[open]').getByRole('link', { name: 'Pets' }).click();
  await expect(page).toHaveURL(/\/pets$/);
  await expect(page.getByRole('heading', { name: 'Pets' })).toBeVisible();
});
