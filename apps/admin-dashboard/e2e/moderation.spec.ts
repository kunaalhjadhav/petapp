import { expect, test } from '@playwright/test';
import { Client } from 'pg';

/**
 * Fixture: a report case against the demo pet "kiwi.demo" (fictional seed data).
 * Created straight in the test database so the browser test doesn't depend on the mobile flow.
 */
const DB = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/petapp';
let caseId = '';
let petId = '';

test.beforeAll(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    const pet = await db.query(`SELECT id, "ownerId" FROM "Pet" WHERE handle = 'kiwi.demo'`);
    const reporter = await db.query(`SELECT id FROM "User" WHERE phone = '+919000000002'`);
    if (!pet.rowCount || !reporter.rowCount) throw new Error('Run `npm run db:seed` with SEED_DEMO_DATA=true first');
    petId = pet.rows[0].id;
    await db.query(`UPDATE "Pet" SET status = 'ACTIVE' WHERE id = $1`, [petId]);
    await db.query(`DELETE FROM "Report" WHERE "targetId" = $1`, [petId]);
    const kase = await db.query(
      `INSERT INTO "ModerationCase" (id, "targetType", "targetId", "openKey", status, "reportCount", "lastReportedAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), 'PET', $1::uuid, 'PET:' || $1::text, 'OPEN', 1, now(), now(), now())
       ON CONFLICT ("openKey") DO UPDATE SET "reportCount" = 1 RETURNING id`,
      [petId],
    );
    caseId = kase.rows[0].id;
    await db.query(
      `INSERT INTO "Report" (id, "reporterId", "targetType", "targetId", reason, details, status, "caseId", "createdAt")
       VALUES (gen_random_uuid(), $1, 'PET', $2, 'ANIMAL_WELFARE', 'Profile photo shows the bird in a tiny cage.', 'OPEN', $3, now())`,
      [reporter.rows[0].id, petId, caseId],
    );
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  await db.query(`UPDATE "Pet" SET status = 'ACTIVE' WHERE id = $1`, [petId]); // leave demo data as it was
  await db.end();
});

test('a moderator reviews a reported pet profile and hides it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /report case.* waiting for review/ })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Moderation' }).first().click();
  const row = page.getByRole('row', { name: /Kiwi/ });
  await expect(row).toContainText('Pet profile');
  await expect(row).toContainText('Animal welfare');
  await row.getByRole('link').click();

  await expect(page).toHaveURL(new RegExp(`/moderation/${caseId}$`));
  await expect(page.getByText('Profile photo shows the bird in a tiny cage.')).toBeVisible();
  // Super admin sees every option, including suspension.
  await expect(page.getByRole('radio', { name: /Remove and suspend the owner/ })).toBeVisible();

  await page.getByRole('radio', { name: /^Hide/ }).check();
  await page.getByRole('button', { name: 'Resolve case' }).click();
  await expect(page.getByLabel('Note')).toBeFocused(); // a note is required; the choice is kept
  await expect(page.getByRole('radio', { name: /^Hide/ })).toBeChecked();
  await page.getByLabel('Note').fill('Welfare concern confirmed from the photo.');
  await page.getByRole('button', { name: 'Resolve case' }).click();

  await expect(page.locator('main header').getByText('Resolved', { exact: true })).toBeVisible();
  await expect(page.getByText('Content hidden')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'History' })).toContainText('Resolved a report');

  await page.goto(`/pets/${petId}`);
  await expect(page.locator('main header').getByText('Hidden', { exact: true })).toBeVisible();
  await page.goto('/moderation?status=RESOLVED');
  await expect(page.getByRole('row', { name: /Kiwi/ }).first()).toContainText('Content hidden');
});
