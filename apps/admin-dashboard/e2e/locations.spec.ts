import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { openDialog } from './helpers';

/** Locations (spec §44–45): cities, areas and PIN codes, delivery zones, service coverage and partner locations. */
const DB = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/petapp';
const tag = Date.now().toString(36);
// Unused PIN codes in a range no real Pune address uses.
const base = 900000 + (Date.now() % 9000) * 10;
const pinA = String(base + 1);
const pinB = String(base + 2);
const area = `Test Nagar ${tag}`;

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
  await sql(`DELETE FROM "Pincode" WHERE code = ANY($1)`, [[pinA, pinB]]);
  await sql(`DELETE FROM "Locality" WHERE name LIKE $1`, [`%${tag}`]);
  await sql(`DELETE FROM "DeliveryZone" WHERE name LIKE $1`, [`%${tag}`]);
  await sql(`UPDATE "City" SET "servicesLive" = false WHERE slug = 'nagpur'`);
});

test('a city: add an area, then import PIN codes after checking them', async ({ page }) => {
  await page.goto('/locations/cities?q=pune');
  await page.getByRole('link', { name: 'Pune', exact: true }).click();
  await expect(page).toHaveURL(/\/locations\/cities\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: 'Add an area' }).click();
  const d = openDialog(page);
  await d.getByLabel('Name').fill(area);
  await d.getByRole('button', { name: 'Add area' }).click();
  await expect(page.getByRole('cell', { name: area, exact: true })).toBeVisible();

  const box = page.getByLabel('Or paste rows');
  await box.fill(`pincode,area,lat,lng\n${pinA},${area},18.51,73.86\n${pinB},Another ${tag},,\nbad,row,,`);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Check:' })).toContainText('2 new PIN codes, 0 updated, 1 new area would be saved.');
  await expect(page.getByText('Line 4: “bad” isn’t a 6-digit PIN code.')).toBeVisible();
  expect(await sql(`SELECT 1 FROM "Pincode" WHERE code = $1`, [pinA])).toHaveLength(0);

  await box.fill(`${pinA},${area},18.51,73.86\n${pinB},Another ${tag},,`);
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toContainText('2 new PIN codes');
  await page.getByPlaceholder('Start of a PIN code, or an area').fill(pinA);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('row').filter({ hasText: pinA })).toContainText(area);
});

test('delivery zones: add one, check a PIN code against it, delete it', async ({ page }) => {
  await page.goto('/locations/zones');
  await page.getByRole('button', { name: 'Add a zone' }).click();
  const d = openDialog(page);
  await d.getByLabel('Name').fill(`Test zone ${tag}`);
  await d.getByLabel('PIN codes').fill(`${String(base).slice(0, 4)}*`);
  await d.getByLabel('Shipping per parcel (₹)').fill('0');
  await d.getByLabel('Earliest (days)').fill('1');
  await d.getByLabel('Latest (days)').fill('2');
  await d.getByRole('button', { name: 'Add zone' }).click();
  const row = page.getByRole('row').filter({ hasText: `Test zone ${tag}` });
  await expect(row).toContainText('Free');
  await expect(row).toContainText('1–2 days');

  await page.getByRole('textbox', { name: 'PIN code', exact: true }).fill(pinA);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: pinA })).toContainText(`Test zone ${tag}. Delivery in 1–2 days.`);

  await row.getByRole('button', { name: 'Delete' }).click();
  await openDialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('row').filter({ hasText: `Test zone ${tag}` })).toHaveCount(0);
});

test('service coverage and partner locations', async ({ page }) => {
  await page.goto('/locations/coverage');
  const nagpur = page.getByRole('row').filter({ hasText: 'Nagpur' });
  await nagpur.getByRole('switch', { name: 'Services live in Nagpur' }).click();
  await expect(nagpur.getByRole('switch', { name: 'Services live in Nagpur' })).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  expect((await sql<{ servicesLive: boolean }>(`SELECT "servicesLive" FROM "City" WHERE slug = 'nagpur'`))[0].servicesLive).toBe(true);
  await expect(page.getByText('Cities with services live')).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'Nagpur' }).getByRole('switch').click();
  await expect(page.getByRole('row').filter({ hasText: 'Nagpur' }).getByRole('switch')).toHaveAttribute('aria-checked', 'false');

  await page.goto('/locations/partners');
  await expect(page.getByRole('heading', { name: 'Partner locations' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Coverage' }).or(page.getByText('No partners match'))).toBeVisible();
});
