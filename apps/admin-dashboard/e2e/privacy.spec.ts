import { expect, test } from '@playwright/test';
import { Client } from 'pg';

/** Legal documents (draft → publish, placeholders refused) and privacy requests (cancel, erase now). */
const DB =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/petapp';
const tag = Date.now().toString(36);

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    return (await db.query(q, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** Someone who asked to delete their account a day ago. */
async function leaver(name: string) {
  const [u] = await sql<{ id: string }>(
    `INSERT INTO "User" (id, name, phone, status, "deletedAt", "phoneVerifiedAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 'PENDING_DELETION', now() - interval '1 day', now(), now(), now()) RETURNING id`,
    [name, `+9192${String(Date.now()).slice(-8)}`],
  );
  return u.id;
}

test('a legal document is edited as a draft and published once its placeholders are filled in', async ({
  page,
}) => {
  await page.goto('/legal');
  await expect(page.getByRole('heading', { name: 'Legal documents' })).toBeVisible();
  const row = page.getByRole('row', { name: /Community Guidelines/ });
  await row.getByRole('link', { name: 'Community Guidelines' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Community Guidelines/ })).toBeVisible();

  // A published version gets a new draft; a first version is already a draft.
  const start = page.getByRole('button', { name: 'Start a new version' });
  if (await start.isVisible()) {
    await start.click();
    await page.getByRole('button', { name: 'Start draft' }).click();
    await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeVisible();
  }
  const body = page.getByLabel('Text (Markdown)');
  const text = await body.inputValue();
  const version = Number((await page.locator('h1').innerText()).match(/version (\d+)/)![1]);

  if (/\{\{/.test(text)) {
    await page.getByRole('button', { name: 'Publish…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
    await expect(
      page.getByRole('dialog').getByText(/Fill in every \{\{placeholder\}\}/),
    ).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  }
  await body.fill(
    `${text.replace(/\{\{([^}]+)\}\}/g, (_m, p: string) => (/^\d/.test(p) ? p : `[${p.trim()}]`))}\n\nReviewed ${tag}.`,
  );
  await page.getByLabel('What changed in this version').fill(`Wording reviewed ${tag}`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Ready to publish.')).toBeVisible();

  await page.getByRole('button', { name: 'Publish…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  // The page becomes the published version.
  await expect(page.getByRole('heading', { level: 1, name: /Community Guidelines/ })).toContainText(
    'Current version',
  );
  await expect(page.getByRole('button', { name: 'Start a new version' })).toBeVisible();
  await expect(page.getByText(`Reviewed ${tag}.`)).toBeVisible();
  // Rendered, not raw Markdown.
  await expect(page.getByRole('heading', { name: 'Contact and grievances' })).toBeVisible();

  // The public API serves it.
  const res = await page.request.get(
    `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/legal/community-guidelines`,
  );
  const doc = (await res.json()).data;
  expect(doc.version).toBe(version);
  expect(doc.body).toContain(`Reviewed ${tag}.`);
});

test('privacy requests: cancel a deletion, or erase an account now', async ({ page }) => {
  const keep = await leaver(`Keeper ${tag}`);
  const gone = await leaver(`Leaver ${tag}`);
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy requests' })).toBeVisible();

  const keepRow = page.getByRole('row', { name: new RegExp(`Keeper ${tag}`) });
  await keepRow.getByRole('button', { name: 'Cancel deletion' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep the account' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Keeper ${tag}`) })).toHaveCount(0);
  expect(
    (await sql<{ status: string }>(`SELECT status FROM "User" WHERE id = $1`, [keep]))[0].status,
  ).toBe('ACTIVE');

  const goneRow = page.getByRole('row', { name: new RegExp(`Leaver ${tag}`) });
  await goneRow.getByRole('button', { name: 'Erase now' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Erase permanently' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Leaver ${tag}`) })).toHaveCount(0);
  const [u] = await sql<{ status: string; name: string | null; phone: string | null }>(
    `SELECT status, name, phone FROM "User" WHERE id = $1`,
    [gone],
  );
  expect(u).toEqual({ status: 'DELETED', name: null, phone: null });

  await page.getByRole('link', { name: 'Erased', exact: true }).click();
  await expect(page.getByText(gone.slice(0, 8)).first()).toBeVisible();
});
