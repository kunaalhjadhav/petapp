import { expect, test } from '@playwright/test';
import { Client } from 'pg';

/** PetApp Assistant: status, limits, and answers people rated (a fresh rated answer each run). */
const DB =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/petapp';
const tag = Date.now().toString(36);
const question = `Where do I find invoices ${tag}?`;

test.beforeAll(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    const user = (
      await db.query(
        `INSERT INTO "User" (id, name, phone, "phoneVerifiedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, now(), now(), now()) RETURNING id`,
        [`Asker ${tag}`, `+9191${String(Date.now()).slice(-8)}`],
      )
    ).rows[0].id;
    const conv = (
      await db.query(
        `INSERT INTO "AssistantConversation" (id, "userId", title) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
        [user, question],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO "AssistantMessage" (id, "conversationId", role, text, "createdAt") VALUES (gen_random_uuid(), $1, 'USER', $2, now() - interval '1 minute')`,
      [conv, question],
    );
    await db.query(
      `INSERT INTO "AssistantMessage" (id, "conversationId", role, text, cards, provider, model, version, rating, "ratingNote", "ratedAt")
       VALUES (gen_random_uuid(), $1, 'ASSISTANT', 'Invoices:\n1. Open Me, then the wallet icon.', '[{"type":"LINK","item":{"id":"invoices"}}]', 'rules', 'petapp-rules', '2026-10', 'DOWN', $2, now())`,
      [conv, `Wanted GST invoices ${tag}`],
    );
  } finally {
    await db.end();
  }
});

test('status, limits and the answers people rated down', async ({ page }) => {
  await page.goto('/assistant');
  await expect(page.getByRole('heading', { name: 'PetApp Assistant' })).toBeVisible();
  await expect(page.getByText('Answers (24 h)')).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(tag) }).first();
  await expect(row).toContainText(question);
  await expect(row).toContainText(`Wanted GST invoices ${tag}`);
  await expect(row).toContainText('Built-in answers');
  await expect(row).toContainText('Showed: link');

  const limit = page.getByLabel('Questions per person per day');
  const original = await limit.inputValue();
  expect(
    await limit.evaluate((el: HTMLInputElement) => ((el.value = '0'), el.checkValidity())),
  ).toBe(false);
  await limit.fill(original === '25' ? '30' : '25');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. Recorded in the audit log.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Questions per person per day')).toHaveValue(
    original === '25' ? '30' : '25',
  );
  await page.getByLabel('Questions per person per day').fill(original);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();

  await page.getByRole('link', { name: 'Thumbs up' }).click();
  await expect(page.getByRole('row', { name: new RegExp(tag) })).toHaveCount(0);
});
