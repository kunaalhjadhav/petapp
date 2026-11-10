import { expect, test } from '@playwright/test';
import { openDialog } from './helpers';

test('create a badge and a challenge, then publish it', async ({ page }) => {
  const tag = Date.now().toString(36);
  await page.goto('/challenges/badges');
  await page.getByRole('button', { name: 'Add badge' }).click();
  await openDialog(page).getByLabel('Name').fill(`Walker ${tag}`);
  await openDialog(page).getByLabel('Description').fill('Walked every day of the challenge.');
  await openDialog(page).getByRole('button', { name: 'Add badge' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Walker ${tag}`) })).toBeVisible();

  await page.goto('/challenges/new');
  await page.getByLabel('Title').fill(`Walk Week ${tag}`);
  await page.getByLabel('Description').fill('Walk your dog every day for a week.');
  // Changing a dropdown re-renders the form; what was typed must survive.
  await page.getByLabel('Who can join').selectOption('PAID');
  await expect(page.getByLabel('Title')).toHaveValue(`Walk Week ${tag}`);
  await page.getByLabel('Fee (₹)').fill('49');
  await page.getByLabel('Who can join').selectOption('FREE');
  await expect(page.getByLabel('Title')).toHaveValue(`Walk Week ${tag}`);
  await page.getByLabel('Check-ins to complete').fill('5');
  await page.getByLabel('Badge on completion').selectOption({ label: `Walker ${tag}` });
  await page.getByRole('button', { name: 'Create draft' }).click();

  await expect(page).toHaveURL(/\/challenges\/[0-9a-f-]{36}$/);
  const header = page.locator('main header');
  await expect(header.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByText('5 check-ins (one per day, India time)')).toBeVisible();
  await expect(page.getByText(`Walker ${tag}`)).toBeVisible();
  await header.getByRole('button', { name: 'Publish' }).click();
  await openDialog(page).getByRole('button', { name: 'Publish' }).click();
  await expect(header.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByText('No one has joined yet.')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'History' })).toContainText('Changed challenge status');
});
