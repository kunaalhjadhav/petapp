import { expect, test } from '@playwright/test';
import { Client } from 'pg';

/**
 * Home screen management: add a section, move it, limit it to a city, pin a pet, preview it in two cities, delete it.
 * A fresh pet each run so it can be repeated.
 */
const DB =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/petapp';
const tag = Date.now().toString(36);
const title = `Spotlight ${tag}`;
const handle = `star${tag}`;

test.beforeAll(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    const owner = (
      await db.query(
        `INSERT INTO "User" (id, name, phone, "phoneVerifiedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, now(), now(), now()) RETURNING id`,
        [`Owner ${tag}`, `+9192${String(Date.now()).slice(-8)}`],
      )
    ).rows[0].id;
    const species = (await db.query(`SELECT id FROM "PetSpecies" ORDER BY "sortOrder" LIMIT 1`))
      .rows[0].id;
    await db.query(
      `INSERT INTO "Pet" (id, "ownerId", "speciesId", name, handle, city, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Pune', now(), now())`,
      [owner, species, `Star ${tag}`, handle],
    );
  } finally {
    await db.end();
  }
});

test('add a section, order it, limit it to a city, pin a pet, preview and delete it', async ({
  page,
}) => {
  await page.goto('/home-screen');
  await expect(page.getByRole('heading', { name: 'Home screen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Coming up' })).toBeVisible(); // a default section

  await page.getByRole('button', { name: 'Add section' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What it shows').selectOption('TRENDING_PETS');
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'Add section' }).click();
  await expect(dialog).toBeHidden();
  const rows = page.getByRole('row');
  const row = rows.filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(rows.last()).toContainText(title); // added at the end

  await page.getByRole('button', { name: `Move ${title} up` }).click();
  await expect(rows.last()).not.toContainText(title);

  await row.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByLabel('Only in these cities').fill('Pune');
  await page.getByLabel('Items to show').fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved. Recorded in the audit log.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Only in these cities')).toHaveValue('Pune');

  await page.getByLabel(/^Pin a pet/).fill('@nobody-like-this');
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.getByText(/Couldn’t find that/)).toBeVisible();
  await page.getByLabel(/^Pin a pet/).fill(`@${handle}`);
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.getByText(`Star ${tag} (@${handle})`)).toBeVisible();

  await page.goto('/home-screen/preview?city=Pune');
  const section = page.locator('section', { has: page.getByRole('heading', { name: title }) });
  await expect(section).toBeVisible();
  await expect(section.getByRole('listitem').first()).toContainText(`Star ${tag}`);
  await expect(section.getByRole('listitem').first()).toContainText('Pinned');

  await page.getByLabel('City').selectOption('Mumbai');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page).toHaveURL(/city=Mumbai/);
  const skipped = page.locator('section', {
    has: page.getByRole('heading', { name: 'Not shown here' }),
  });
  await expect(skipped.getByRole('listitem').filter({ hasText: title })).toContainText(
    'Only for other cities',
  );

  await skipped.getByRole('link', { name: title }).click();
  await page.getByRole('button', { name: 'Delete section' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/home-screen$/);
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
});

test('recommendation settings: history is kept for 1 to 365 days', async ({ page }) => {
  await page.goto('/home-screen');
  const days = page.getByLabel('Keep viewing history for (days)');
  const original = await days.inputValue();
  await days.fill('0');
  expect(await days.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false); // the browser stops it
  await days.fill('400');
  expect(await days.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
  await days.fill(original === '120' ? '90' : '120');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved. Recorded in the audit log.')).toBeVisible();
  await days.fill(original);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved\.|Nothing changed/)).toBeVisible();
});
