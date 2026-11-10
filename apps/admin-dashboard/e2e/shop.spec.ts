import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { openDialog } from './helpers';

/**
 * Fixtures straight in the database: a submitted vendor with an ID document, and a listed product.
 * Each run uses fresh names so it can be repeated.
 */
const DB = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/petapp';
const tag = Date.now().toString(36);
const store = `Paws Mart ${tag}`;
const productTitle = `Calming Chews ${tag}`;
let vendorId = '';

test.beforeAll(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    const user = await db.query(`INSERT INTO "User" (id, name, phone, "phoneVerifiedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, now(), now(), now()) RETURNING id`, [`Owner ${tag}`, `+9197${String(Date.now()).slice(-8)}`]);
    const uid = user.rows[0].id;
    const media = await db.query(
      `INSERT INTO "MediaAsset" (id, "ownerId", kind, "mimeType", "sizeBytes", "storageKey", status, variants, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'DOCUMENT', 'application/pdf', 1000, $2, 'READY', '{}', now(), now()) RETURNING id`,
      [uid, `uploads/${uid}/id.pdf`],
    );
    const vendor = await db.query(
      `INSERT INTO "Vendor" (id, "userId", "businessName", slug, phone, "addressLine", city, state, pincode, status, "submittedAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, '+919800000000', '1 Market Road', 'Pune', 'Maharashtra', '411001', 'SUBMITTED', now(), now(), now()) RETURNING id`,
      [uid, store, `paws-mart-${tag}`],
    );
    vendorId = vendor.rows[0].id;
    await db.query(`INSERT INTO "VendorDocument" (id, "vendorId", kind, "mediaId", status, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'ID_PROOF', $2, 'PENDING', now(), now())`, [vendorId, media.rows[0].id]);
    const cat = await db.query(`INSERT INTO "ProductCategory" (id, key, name, "commissionBps", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 1000, now(), now()) RETURNING id`, [`treats-${tag}`, `Treats ${tag}`]);
    await db.query(
      `INSERT INTO "Product" (id, "vendorId", "categoryId", title, slug, description, status, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Soft chews for anxious dogs.', 'ACTIVE', now(), now())`,
      [vendorId, cat.rows[0].id, productTitle, `calming-chews-${tag}`],
    );
  } finally {
    await db.end();
  }
});

test('review a vendor, add a category, create a coupon, and block a product', async ({ page }) => {
  // Vendor review
  await page.goto('/shop/vendors');
  await page.getByRole('link', { name: store }).click();
  await expect(page.locator('main header').getByText('Waiting for review', { exact: true })).toBeVisible();
  await page.locator('main header').getByRole('button', { name: 'Approve' }).click();
  const dialog = openDialog(page);
  await dialog.getByRole('radio', { name: 'Accept' }).check();
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('main header').getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByText('Each category’s standard rate', { exact: true })).toBeVisible();

  // Category
  await page.goto('/shop/categories');
  await page.getByRole('button', { name: 'Add category' }).click();
  await openDialog(page).getByLabel('Name').fill(`Toys ${tag}`);
  await openDialog(page).getByLabel('Commission (%)').fill('15');
  await openDialog(page).getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Toys ${tag}`) })).toContainText('15%');

  // Coupon
  const code = `SAVE${tag.slice(-5).toUpperCase()}`;
  await page.goto('/shop/coupons');
  await page.getByRole('button', { name: 'New coupon' }).click();
  const c = openDialog(page);
  await c.getByLabel('Code').fill(code);
  await c.getByLabel('Discount (%)').fill('10');
  await c.getByLabel('Maximum discount (₹)').fill('100');
  await expect(c.getByLabel('Starts')).not.toHaveValue(''); // filled in the browser's time zone
  await c.getByRole('button', { name: 'Create coupon' }).click();
  const row = page.getByRole('row', { name: new RegExp(code) });
  await expect(row).toContainText('10% off, up to ₹100');
  await expect(row).toContainText('Live');
  await expect(row).toContainText('PetApp');

  // Product moderation
  await page.goto(`/shop/products?q=${encodeURIComponent(productTitle)}`);
  const prow = page.getByRole('row', { name: new RegExp(productTitle) });
  await expect(prow).toContainText('In the shop');
  await prow.getByRole('button', { name: 'Block' }).click();
  await openDialog(page).getByLabel('Reason (the vendor sees this)').fill('Unverified medical claims on the label.');
  await openDialog(page).getByRole('button', { name: 'Block' }).click();
  await expect(prow).toContainText('Blocked: Unverified medical claims on the label.');
  await page.goto(`/shop/vendors/${vendorId}`);
  await expect(page.getByRole('complementary', { name: 'History' })).toContainText('Approved the store');
});
