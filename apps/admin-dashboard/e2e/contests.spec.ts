import { expect, test } from '@playwright/test';
import { openDialog } from './helpers';

// Uses the seeded super admin and the demo judge (Dr. Arjun Rao). Creates a new contest each run.

test('build a paid contest, pass the legal gate, go live, and preview the money', async ({ page }) => {
  const title = `E2E Glam Contest ${Date.now().toString(36)}`;
  await page.goto('/contests/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('Show us your best-groomed pet this season.');
  await page.getByLabel('Entry fee (₹)').fill('100');
  await page.getByLabel('Minimum entries').fill('2');
  await page.getByLabel('Maximum entries').fill('100');
  await page.getByLabel('Task', { exact: true }).fill('Post a grooming photo');
  await page.getByRole('checkbox', { name: 'Dr. Arjun Rao' }).check();
  await expect(page.getByText('(weights total 100 of 100)')).toBeVisible();
  await expect(page.getByText(/At 100 entries: ₹10,000 collected, ₹6,000 prize pool/)).toBeVisible();
  await page.getByRole('button', { name: 'Create draft' }).click();

  await expect(page).toHaveURL(/\/contests\/[0-9a-f-]{36}$/);
  const header = page.locator('main header');
  await expect(header.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByText('Before this can be scheduled')).toHaveCount(0); // complete

  const step = async (button: string, expectStatus: string) => {
    await header.getByRole('button', { name: button }).click();
    await openDialog(page).getByRole('button', { name: button }).click();
    await expect(header.getByText(expectStatus, { exact: true })).toBeVisible();
  };
  await step('Send for review', 'In review');
  await step('Approve and schedule', 'Scheduled');

  // The legal gate blocks a paid contest from going live…
  await expect(page.getByText('Not recorded. This paid contest can’t go live until it is.')).toBeVisible();
  await header.getByRole('button', { name: 'Go live' }).click();
  await openDialog(page).getByRole('button', { name: 'Go live' }).click();
  await expect(openDialog(page).getByText('Paid contests need a recorded legal review before they can go live.')).toBeVisible();
  await openDialog(page).getByRole('button', { name: 'Cancel' }).click();

  // …until a super admin records it.
  await page.getByRole('button', { name: 'Record legal review' }).click();
  await openDialog(page).getByLabel('Reviewer and reference').fill('Reviewed by counsel, opinion ref LGL-E2E-001');
  await openDialog(page).getByRole('button', { name: 'Record review' }).click();
  await expect(page.getByText('Recorded', { exact: true })).toBeVisible();
  await step('Go live', 'Live');

  await page.getByLabel('What if').fill('100');
  await page.getByRole('button', { name: 'Show' }).click();
  const table = page.locator('table').filter({ hasText: 'If 100 enter' });
  await expect(table.getByRole('row', { name: /Collected/ })).toContainText('₹10,000');
  await expect(table.getByRole('row', { name: /Prize pool/ })).toContainText('₹6,000');
  await expect(page.getByRole('complementary', { name: 'History' })).toContainText('Recorded the legal review');

  await page.goto('/contests');
  await expect(page.getByRole('row', { name: new RegExp(title) })).toContainText('Live');
});
