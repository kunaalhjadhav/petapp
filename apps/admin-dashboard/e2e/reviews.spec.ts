import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { openDialog } from './helpers';

/** Reviews (spec §38) and the reports dashboard (spec §59). */
const DB =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/petapp';
const tag = Date.now().toString(36);
const productTitle = `Salmon bites ${tag}`;
const comment = `Crunchy and my cat loves them ${tag}`;

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    return (await db.query(q, params)).rows as T[];
  } finally {
    await db.end();
  }
}

let sellerId: string;
let buyerId: string;
let reporterId: string;
let productId: string;
let reviewId: string;

test.beforeAll(async () => {
  const person = async (name: string, n: number) =>
    (
      await sql<{ id: string }>(
        `INSERT INTO "User" (id, name, phone, status, "phoneVerifiedAt", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now(), now()) RETURNING id`,
        [name, `+919${n}${String(Date.now()).slice(-8)}`],
      )
    )[0].id;
  sellerId = await person(`Seller ${tag}`, 41);
  buyerId = await person(`Kavya Menon ${tag}`, 42);
  reporterId = await person(`Ravi ${tag}`, 43);
  const [vendor] = await sql<{ id: string }>(
    `INSERT INTO "Vendor" (id, "userId", "businessName", slug, phone, "addressLine", city, state, pincode, status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, '+919800000000', '1 Market Road', 'Pune', 'Maharashtra', '411001', 'APPROVED', now(), now()) RETURNING id`,
    [sellerId, `Whisker Mart ${tag}`, `whisker-${tag}`],
  );
  const [cat] = await sql<{ id: string }>(
    `INSERT INTO "ProductCategory" (id, key, name, "commissionBps", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 1000, now(), now()) RETURNING id`,
    [`cat-treats-${tag}`, `Cat treats ${tag}`],
  );
  // A review already counted in the product's rating, as the API would have left it.
  [{ id: productId }] = await sql<{ id: string }>(
    `INSERT INTO "Product" (id, "vendorId", "categoryId", title, slug, description, status, "ratingAvg", "ratingCount", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Freeze-dried salmon.', 'ACTIVE', 4, 1, now(), now()) RETURNING id`,
    [vendor.id, cat.id, productTitle, `salmon-bites-${tag}`],
  );
  const [order] = await sql<{ id: string }>(
    `INSERT INTO "Order" (id, code, "userId", status, "itemsPaise", "discountPaise", "shippingPaise", "totalPaise", "shipTo", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 'COMPLETED', 39900, 0, 0, 39900, '{}', now(), now()) RETURNING id`,
    [`O-${tag}`, buyerId],
  );
  const [parcel] = await sql<{ id: string }>(
    `INSERT INTO "SubOrder" (id, "orderId", "vendorId", code, status, "itemsPaise", "discountPaise", "shippingPaise", "totalPaise", "commissionPaise", "vendorEarningPaise", "deliveredAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'DELIVERED', 39900, 0, 0, 39900, 3990, 35910, now(), now(), now()) RETURNING id`,
    [order.id, vendor.id, `S-${tag}`],
  );
  [{ id: reviewId }] = await sql<{ id: string }>(
    `INSERT INTO "ProductReview" (id, "productId", "vendorId", "customerId", "subOrderId", rating, comment, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 4, $5, now(), now()) RETURNING id`,
    [productId, vendor.id, buyerId, parcel.id, comment],
  );
  const [kase] = await sql<{ id: string }>(
    `INSERT INTO "ModerationCase" (id, "targetType", "targetId", "openKey", status, "reportCount", "lastReportedAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), 'PRODUCT_REVIEW', $1::uuid, 'PRODUCT_REVIEW:' || $1::text, 'OPEN', 1, now(), now(), now()) RETURNING id`,
    [reviewId],
  );
  await sql(
    `INSERT INTO "Report" (id, "reporterId", "targetType", "targetId", reason, details, status, "caseId", "createdAt")
     VALUES (gen_random_uuid(), $1, 'PRODUCT_REVIEW', $2, 'SPAM', $3, 'OPEN', $4, now())`,
    [reporterId, reviewId, `Copied from another site ${tag}`, kase.id],
  );
});

test.afterAll(async () => {
  await sql(`DELETE FROM "Report" WHERE "reporterId" = $1`, [reporterId]);
  await sql(`DELETE FROM "ModerationCase" WHERE "targetId" = $1`, [reviewId]);
  await sql(`DELETE FROM "Order" WHERE "userId" = $1`, [buyerId]);
  await sql(`DELETE FROM "Product" WHERE id = $1`, [productId]);
  await sql(`DELETE FROM "Vendor" WHERE "userId" = $1`, [sellerId]);
  await sql(`DELETE FROM "ProductCategory" WHERE key = $1`, [`cat-treats-${tag}`]);
  await sql(`DELETE FROM "User" WHERE id = ANY($1::uuid[])`, [[sellerId, buyerId, reporterId]]);
});

test('staff hide a review, which takes it out of the rating, and show it again', async ({ page }) => {
  await page.goto(`/reviews?q=${encodeURIComponent(tag)}`);
  const row = page.getByRole('row').filter({ hasText: comment });
  await expect(row).toBeVisible();
  await expect(row).toContainText(productTitle);
  await expect(row).toContainText('Verified purchase');
  await expect(row.getByRole('link', { name: '1 report' })).toBeVisible();

  await row.getByRole('button', { name: 'Hide' }).click();
  const d = openDialog(page);
  await d.getByLabel('Why').fill('Not about the product');
  await d.getByRole('button', { name: 'Hide review' }).click();
  await expect(row.getByText('Hidden', { exact: true })).toBeVisible();
  const [hidden] = await sql<{ ratingCount: number }>(`SELECT "ratingCount" FROM "Product" WHERE id = $1`, [productId]);
  expect(hidden.ratingCount).toBe(0);

  await row.getByRole('button', { name: 'Show again' }).click();
  await openDialog(page).getByRole('button', { name: 'Show review' }).click();
  await expect(row.getByText('Shown', { exact: true })).toBeVisible();
  const [shown] = await sql<{ ratingCount: number; ratingAvg: number }>(`SELECT "ratingCount", "ratingAvg" FROM "Product" WHERE id = $1`, [productId]);
  expect(shown).toEqual({ ratingCount: 1, ratingAvg: 4 });
});

test('the reports dashboard shows each report and, once decided, the moderator and outcome', async ({ page }) => {
  await page.goto(`/reports?q=${encodeURIComponent(`Copied from another site ${tag}`)}`);
  const row = page.getByRole('row').filter({ hasText: `Ravi ${tag}` });
  await expect(row).toContainText('Product review');
  await expect(row).toContainText('Spam');
  await expect(row).toContainText(`4★ for ${productTitle}`.slice(0, 20));
  await expect(row).toContainText('Open');
  await expect(row).toContainText('Waiting');

  await row.getByRole('link', { name: /4★ for/ }).click();
  await expect(page).toHaveURL(/\/moderation\/[0-9a-f-]{36}$/);
  await expect(page.getByText(comment)).toBeVisible();
  // Reviews can be hidden from the case; the hint says what that means.
  await expect(page.getByRole('radio', { name: /^Hide.*stops counting towards the rating/ })).toBeVisible();
  await page.getByRole('radio', { name: /^Dismiss/ }).check();
  await page.getByLabel('Note').fill('Looks genuine');
  await page.getByRole('button', { name: 'Resolve case' }).click();
  await expect(page.getByText('“Looks genuine”')).toBeVisible();

  await page.goto(`/reports?status=DISMISSED&q=${encodeURIComponent(`Copied from another site ${tag}`)}`);
  const done = page.getByRole('row').filter({ hasText: `Ravi ${tag}` });
  await expect(done).toContainText('Dismissed');
  await expect(done).toContainText('“Looks genuine”');
  await expect(done.getByRole('cell').nth(6)).not.toHaveText('—');
});
