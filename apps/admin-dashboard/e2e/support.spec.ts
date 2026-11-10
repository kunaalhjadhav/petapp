import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { openDialog } from './helpers';

/** Support center: staff start a conversation with someone, reply, add notes, and manage the help center. */
const DB =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/petapp';
const API = process.env.BACKEND_URL ?? 'http://localhost:4000';
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

let personId: string;

test.beforeAll(async () => {
  const [u] = await sql<{ id: string }>(
    `INSERT INTO "User" (id, name, phone, status, "phoneVerifiedAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now(), now()) RETURNING id`,
    [`Meera ${tag}`, `+9193${String(Date.now()).slice(-8)}`],
  );
  personId = u.id;
});

test.afterAll(async () => {
  // Leave the dashboard as we found it: the person (and their ticket) and the topic made here go.
  await sql(`DELETE FROM "Conversation" WHERE "customerId" = $1`, [personId]);
  await sql(`DELETE FROM "User" WHERE id = $1`, [personId]);
  await sql(`DELETE FROM "SupportCategory" WHERE key = $1`, [`e2e-${tag}`]);
});

test('staff message someone, add a note, and wait for their reply', async ({ page }) => {
  await page.goto(`/users/${personId}`);
  await page.getByRole('button', { name: 'Message' }).click();
  const d = openDialog(page);
  await d.getByLabel('Subject').fill(`Your refund ${tag}`);
  await d.getByLabel('Topic').selectOption({ label: 'Payments and refunds' });
  await d.getByLabel('Message').fill('Hi Meera, your refund was sent today.');
  await d.getByRole('button', { name: 'Send' }).click();

  await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`Your refund ${tag}`) })).toBeVisible();
  const thread = page.getByRole('list', { name: 'Messages' });
  await expect(thread.getByText('Hi Meera, your refund was sent today.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).getByText('In progress')).toBeVisible();

  // A note stays between staff.
  await page.getByLabel('Message', { exact: true }).fill('Checked the gateway: rfnd_e2e.');
  await page.getByLabel('Note for staff only').check();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(thread.getByText('Checked the gateway: rfnd_e2e.')).toBeVisible();
  await expect(thread.getByText(/^Note ·/)).toBeVisible();

  // Reply and wait for them.
  await page.getByLabel('Message', { exact: true }).fill('Let us know when it arrives.');
  await page.getByLabel('Then').selectOption('WAITING');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(thread.getByText('Let us know when it arrives.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).getByText('Waiting for them')).toBeVisible();

  await page.goto('/support?view=waiting');
  await expect(page.getByRole('link', { name: new RegExp(`Your refund ${tag}`) })).toBeVisible();
  // The person's own view leaves the note out.
  const [t] = await sql<{ conversationId: string }>(`SELECT "conversationId" FROM "SupportTicket" WHERE "userId" = $1`, [personId]);
  const visible = await sql<{ n: string }>(`SELECT count(*) AS n FROM "ChatMessage" WHERE "conversationId" = $1 AND NOT internal AND side = 'STAFF'`, [t.conversationId]);
  expect(Number(visible[0].n)).toBe(2);
});

test('a help center question is drafted, published and shown in the apps', async ({ page, request }) => {
  const question = `How do I change my phone number ${tag}?`;
  await page.goto('/support/faqs');
  await page.getByRole('link', { name: 'New question' }).click();
  await page.getByLabel('Question').fill(question);
  await page.getByLabel('Answer (Markdown)').fill('Open **Settings → Account** and tap **Phone number**.');
  await page.getByLabel('Shown in').selectOption('CUSTOMER');
  await page.getByRole('button', { name: 'Add question' }).click();
  await expect(page.getByRole('heading', { level: 1, name: question })).toBeVisible();
  await expect(page.getByText('How it looks (as last saved)')).toBeVisible();

  const shown = async () =>
    ((await (await request.get(`${API}/api/v1/support/faqs?app=customer`)).json()).data.faqs as Array<{ question: string }>).some((f) => f.question === question);
  expect(await shown()).toBe(false);

  await page.goto('/support/faqs');
  await page.getByRole('switch', { name: `Show “${question}” in the apps` }).click();
  await expect.poll(shown).toBe(true);

  await page.getByRole('link', { name: question }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await openDialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/support\/faqs$/);
  await expect(page.getByRole('link', { name: question })).toHaveCount(0);
});

test('topics are added and switched off', async ({ page }) => {
  await page.goto('/support/topics');
  await page.getByRole('button', { name: 'New topic' }).click();
  const d = openDialog(page);
  await d.getByLabel('Name').fill(`Delivery ${tag}`);
  await d.getByLabel('Key').fill(`e2e-${tag}`);
  await d.getByRole('button', { name: 'Add topic' }).click();
  const row = page.getByRole('row', { name: new RegExp(`e2e-${tag}`) });
  await expect(row).toBeVisible();
  await row.getByRole('switch').click();
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});
