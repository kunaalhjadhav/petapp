import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, openDialog } from './helpers';

// Uses the fictional demo data from `npm run db:seed` with SEED_DEMO_DATA=true.
// Every test restores what it changes, so the suite can run repeatedly.

test('suspends and restores a person, with the reason in their history', async ({ page }) => {
  await page.goto('/users?search=Aanya');
  await page.getByRole('link', { name: /Aanya Kapoor/ }).click();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Aanya Kapoor');
  const header = page.locator('main header');
  // Start from Active even if an earlier interrupted run left the account suspended.
  if (await header.getByRole('button', { name: 'Change status' }).isVisible()) {
    await header.getByRole('button', { name: 'Change status' }).click();
    await openDialog(page).getByLabel('New status').selectOption('ACTIVE');
    await openDialog(page).getByLabel('Reason').fill('E2E: reset before test');
    await openDialog(page).getByRole('button', { name: 'Change status' }).click();
  }
  await expect(header.getByText('Active', { exact: true })).toBeVisible();

  await header.getByRole('button', { name: 'Suspend or block' }).click();
  // A reason is required, and a failed submit keeps the form open.
  await openDialog(page).getByRole('button', { name: 'Change status' }).click();
  await expect(openDialog(page)).toBeVisible();
  await openDialog(page).getByLabel('Reason').fill('E2E: spam report R-1042');
  await openDialog(page).getByRole('button', { name: 'Change status' }).click();
  await expect(header.getByText('Suspended', { exact: true })).toBeVisible();
  await expect(page.getByText('Reason on record:')).toBeVisible();
  // Newest history entry describes this change in plain words.
  await expect(page.getByRole('complementary', { name: 'History' }).getByRole('listitem').first()).toContainText(
    'Active to Suspended. “E2E: spam report R-1042”',
  );

  await header.getByRole('button', { name: 'Change status' }).click();
  await openDialog(page).getByLabel('New status').selectOption('ACTIVE');
  await openDialog(page).getByLabel('Reason').fill('E2E: restored');
  await openDialog(page).getByRole('button', { name: 'Change status' }).click();
  await expect(header.getByText('Active', { exact: true })).toBeVisible();
});

test('verifies a pet and the verified filter finds it', async ({ page }) => {
  await page.goto('/pets?search=bruno');
  await page.getByRole('link', { name: /Bruno/ }).first().click();
  await expect(page).toHaveURL(/\/pets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bruno');
  const header = page.locator('main header');
  const wasVerified = await header.getByText('Verified', { exact: true }).isVisible();

  await header
    .getByRole('button', { name: wasVerified ? 'Remove verification' : 'Verify' })
    .click();
  await openDialog(page)
    .getByRole('button', { name: wasVerified ? 'Remove verification' : 'Verify' })
    .click();
  await expect(header.getByText('Verified', { exact: true })).toBeVisible({
    visible: !wasVerified,
  });

  await page.goto('/pets?verified=1');
  const row = page.getByRole('row', { name: /Bruno/ });
  await (wasVerified ? expect(row).toHaveCount(0) : expect(row).toHaveCount(1));

  // restore
  await page.goBack();
  await header
    .getByRole('button', { name: wasVerified ? 'Verify' : 'Remove verification' })
    .click();
  await openDialog(page)
    .getByRole('button', { name: wasVerified ? 'Verify' : 'Remove verification' })
    .click();
  await expect(header.getByText('Verified', { exact: true })).toBeVisible({ visible: wasVerified });
});

test('turns a feature on and off, and the change is audited with a readable name', async ({
  page,
}) => {
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: /^Reels and posts/ });
  const before = await toggle.getAttribute('aria-checked');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
  await page.reload();
  await expect(page.getByRole('switch', { name: /^Reels and posts/ })).toHaveAttribute(
    'aria-checked',
    before === 'true' ? 'false' : 'true',
  );

  await page.goto('/audit?action=flag.update');
  await expect(page.getByRole('link', { name: 'Feature: Reels and posts' }).first()).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('switch', { name: /^Reels and posts/ }).click();
  await expect(page.getByRole('switch', { name: /^Reels and posts/ })).toHaveAttribute(
    'aria-checked',
    before ?? 'false',
  );
});

test('adds a breed and hides it again', async ({ page }) => {
  await page.goto('/species');
  const name = `E2E breed ${Date.now().toString(36)}`;
  await page.getByLabel('New breed').fill(name);
  await page.getByRole('button', { name: 'Add breed' }).click();
  await expect(page.getByLabel('Breed name').and(page.locator(`[value="${name}"]`))).toBeVisible();
  await page.getByRole('switch', { name: `Show ${name} in the app` }).click();
  await expect(page.getByRole('switch', { name: `Show ${name} in the app` })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('searches people and pets together', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search people and pets').fill('bruno');
  await page.getByLabel('Search people and pets').press('Enter');
  await expect(page.getByRole('heading', { name: 'Results for “bruno”' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Bruno.*@bruno\.demo/ })).toBeVisible();
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('redirects to sign-in, keeps the email after a wrong password, then returns to the page', async ({
    page,
  }) => {
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login\?next=%2Fusers/);
    await page.getByLabel('Work email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill('definitely-wrong-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
    await expect(page.getByLabel('Work email')).toHaveValue(ADMIN_EMAIL);
    await page
      .getByLabel('Password')
      .fill(process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();

    // Signing out ends the session; pages are protected again.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login\?out=1/);
    await page.goto('/audit');
    await expect(page).toHaveURL(/\/login/);
  });

  test('ignores an off-site "next" link after sign-in (no open redirect)', async ({ page }) => {
    await page.goto('/login?next=//evil.example.com');
    await page.getByLabel('Work email').fill(ADMIN_EMAIL);
    await page
      .getByLabel('Password')
      .fill(process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    const url = new URL(page.url());
    expect(url.host).toBe(new URL(test.info().project.use.baseURL!).host);
    expect(url.pathname).toBe('/');
  });
});
