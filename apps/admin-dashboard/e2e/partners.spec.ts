import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { openDialog } from './helpers';

// Uses the seeded demo partner "Pawfect Grooming Spa" (fictional). Reset before and after so the test can rerun.
const DB = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/petapp';
async function reset() {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    const r = await db.query(`UPDATE "ServicePartner" SET status = 'SUBMITTED', "statusReason" = NULL, "commissionBps" = NULL WHERE slug = 'pawfect-grooming-spa-demo' RETURNING id`);
    if (!r.rowCount) throw new Error('Run `npm run db:seed` with SEED_DEMO_DATA=true first');
    await db.query(`UPDATE "PartnerDocument" SET status = 'PENDING', note = NULL WHERE "partnerId" = $1`, [r.rows[0].id]);
  } finally {
    await db.end();
  }
}
test.beforeAll(reset);
test.afterAll(reset);

test('verify a service partner: documents, approval, commission', async ({ page }) => {
  await page.goto('/partners');
  const row = page.getByRole('row', { name: /Pawfect Grooming Spa/ });
  await expect(row).toContainText('Bandra West, Mumbai');
  await row.getByRole('link', { name: 'Pawfect Grooming Spa' }).click();

  const header = page.locator('main header');
  await expect(header.getByText('Waiting for review', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /ID proof/ })).toContainText('Pending');
  await expect(page.getByRole('row', { name: /Full groom/ })).toContainText('₹799');
  await expect(page.getByRole('row', { name: /Full groom/ })).toContainText('Home visit');
  await expect(page.getByRole('listitem').filter({ hasText: 'Monday' })).toContainText('9:00 am–8:00 pm');
  await expect(page.getByRole('link', { name: /19\.05960, 72\.82950/ })).toHaveAttribute('href', /google\.com\/maps\?q=19\.0596,72\.8295/);

  await header.getByRole('button', { name: 'Approve' }).click();
  const dialog = openDialog(page);
  await expect(dialog.getByRole('link', { name: 'Open document' })).toHaveAttribute('href', /X-Amz-Signature=/); // short-lived signed link
  await dialog.getByRole('radio', { name: 'Accept' }).check();
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(header.getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /ID proof/ })).toContainText('Accepted');

  await page.getByRole('button', { name: /^Commission:/ }).click();
  await openDialog(page).getByLabel('Commission (%)').fill('12');
  await openDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Commission: 12% (custom)' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'History' })).toContainText('Approved the partner');

  await page.goto('/partners?status=APPROVED');
  await expect(page.getByRole('row', { name: /Pawfect Grooming Spa/ })).toBeVisible();
  await page.goto('/service-categories');
  await expect(page.getByRole('row', { name: /Grooming/ }).first()).toContainText('15%');
  await page.goto('/bookings');
  await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible();
});
