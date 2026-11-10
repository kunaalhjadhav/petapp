import { expect, test, type Page } from '@playwright/test';
import { makePet, one, sql } from './data';

const tag = Date.now().toString(36);
let publicPet: string;
let privatePet: string;
let friendsPet: string;

test.beforeAll(async () => {
  publicPet = await makePet('PUBLIC', tag);
  privatePet = await makePet('PRIVATE', tag);
  friendsPet = await makePet('FOLLOWERS', tag);
});

const meta = (page: Page, sel: string) => page.locator(sel).first().getAttribute('content');
async function jsonLd(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  // A page may put several items in one script as an array.
  return blocks.flatMap((b) => JSON.parse(b));
}

test('a public pet: title, description, canonical, Open Graph, structured data and the app link', async ({
  page,
}) => {
  await page.goto(`/pet/${publicPet}`);
  await expect(page.getByRole('heading', { level: 1, name: `Biscuit ${tag}` })).toBeVisible();
  await expect(page).toHaveTitle(`Biscuit ${tag} (@${publicPet}) | PetApp`);
  expect(await meta(page, 'meta[name="description"]')).toBe('Loves long walks on Juhu beach.');
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(
    new RegExp(`/pet/${publicPet.replace('.', '\\.')}$`),
  );
  expect(await meta(page, 'meta[property="og:type"]')).toBe('profile');
  // No photo yet: the PetApp share card.
  expect(await meta(page, 'meta[property="og:image"]')).toMatch(/\/og$/);
  const [ld] = await jsonLd(page);
  expect(ld['@type']).toBe('ProfilePage');
  expect(ld.mainEntity.alternateName).toBe(`@${publicPet}`);
  await expect(page.getByRole('link', { name: 'Open in PetApp' })).toHaveAttribute(
    'href',
    `petapp://pet/${publicPet}`,
  );
  // The page is about the pet: its owner's name appears nowhere, not even in the data.
  expect(await page.content()).not.toContain('Secretname');
});

test('private pets are not found; followers-only pets show only their name and stay out of search', async ({
  page,
}) => {
  const r = await page.goto(`/pet/${privatePet}`);
  expect(r?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
  expect(await page.content()).not.toContain('Juhu');

  await page.goto(`/pet/${friendsPet}`);
  await expect(page.getByText('shared with followers only')).toBeVisible();
  expect(await meta(page, 'meta[name="robots"]')).toContain('noindex');
  expect(await page.content()).not.toContain('Juhu');
});

test('a product: price, sizes and Product structured data in rupees', async ({ page }) => {
  const slug = await one(
    `SELECT p.slug AS v FROM "Product" p JOIN "Vendor" v ON v.id = p."vendorId" WHERE p.status = 'ACTIVE' AND v.status = 'APPROVED' ORDER BY p."createdAt" DESC LIMIT 1`,
  );
  test.skip(!slug, 'This database has none to show');
  await page.goto(`/product/${slug}`);
  await expect(page.getByRole('heading', { name: 'Sizes and prices' })).toBeVisible();
  const ld = (await jsonLd(page)).find((x) => x['@type'] === 'Product');
  expect(ld.offers.priceCurrency).toBe('INR');
  expect(Number(ld.offers.price ?? ld.offers.lowPrice)).toBeGreaterThan(0);
  expect((await jsonLd(page)).some((x) => x['@type'] === 'BreadcrumbList')).toBe(true);
  await expect(page.getByRole('link', { name: 'Open in PetApp' })).toHaveAttribute(
    'href',
    `petapp://product/${slug}`,
  );
});

test('a product with a review: the breakdown, a verified purchase, and its rating in structured data', async ({ page }) => {
  const tag = Date.now().toString(36);
  const person = async (name: string) =>
    (await sql<{ id: string }>(`INSERT INTO "User" (id, name, phone, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id`, [name, `+9194${String(Date.now()).slice(-8)}`]))[0].id;
  const seller = await person(`Seller ${tag}`);
  const buyer = await person('Kavya Menon');
  const [v] = await sql<{ id: string }>(
    `INSERT INTO "Vendor" (id, "userId", "businessName", slug, phone, "addressLine", city, state, pincode, status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, '+919800000000', '1 Road', 'Pune', 'Maharashtra', '411001', 'APPROVED', now(), now()) RETURNING id`,
    [seller, `Tails ${tag}`, `tails-${tag}`],
  );
  const [c] = await sql<{ id: string }>(`INSERT INTO "ProductCategory" (id, key, name, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id`, [`web-${tag}`, `Web ${tag}`]);
  const slug = `tuna-${tag}`;
  const [p] = await sql<{ id: string }>(
    `INSERT INTO "Product" (id, "vendorId", "categoryId", title, slug, description, status, "ratingAvg", "ratingCount", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Tuna flakes.', 'ACTIVE', 5, 1, now(), now()) RETURNING id`,
    [v.id, c.id, `Tuna flakes ${tag}`, slug],
  );
  await sql(`INSERT INTO "ProductVariant" (id, "productId", sku, title, "mrpPaise", "pricePaise", stock, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'T1', '100 g', 19900, 14900, 3, now(), now())`, [p.id]);
  const [o] = await sql<{ id: string }>(`INSERT INTO "Order" (id, code, "userId", status, "itemsPaise", "discountPaise", "shippingPaise", "totalPaise", "shipTo", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'COMPLETED', 14900, 0, 0, 14900, '{}', now(), now()) RETURNING id`, [`O-${tag}`, buyer]);
  const [so] = await sql<{ id: string }>(
    `INSERT INTO "SubOrder" (id, "orderId", "vendorId", code, status, "itemsPaise", "discountPaise", "shippingPaise", "totalPaise", "commissionPaise", "vendorEarningPaise", "deliveredAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'DELIVERED', 14900, 0, 0, 14900, 0, 14900, now(), now(), now()) RETURNING id`,
    [o.id, v.id, `S-${tag}`],
  );
  await sql(
    `INSERT INTO "ProductReview" (id, "productId", "vendorId", "customerId", "subOrderId", rating, comment, reply, "variantTitle", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 5, 'My cat begs for these', 'Thank you!', '100 g', now(), now())`,
    [p.id, v.id, buyer, so.id],
  );
  try {
    await page.goto(`/product/${slug}`);
    const reviews = page.locator('section', { has: page.getByRole('heading', { name: 'Reviews' }) });
    await expect(reviews.getByText('My cat begs for these')).toBeVisible();
    await expect(reviews.getByText('Verified purchase')).toBeVisible();
    await expect(reviews.getByText('Kavya M.,', { exact: false })).toBeVisible();
    await expect(reviews.getByText('Reply: Thank you!')).toBeVisible();
    // Only the first name and initial are public.
    expect(await page.content()).not.toContain('Kavya Menon');
    const ld = (await jsonLd(page)).find((x) => x['@type'] === 'Product');
    expect(ld.aggregateRating).toMatchObject({ ratingValue: '5.0', reviewCount: 1 });
    expect(ld.review[0]).toMatchObject({ author: { name: `Kavya M.` }, reviewRating: { ratingValue: 5 } });
  } finally {
    await sql(`DELETE FROM "Order" WHERE id = $1`, [o.id]);
    await sql(`DELETE FROM "Product" WHERE id = $1`, [p.id]);
    await sql(`DELETE FROM "Vendor" WHERE id = $1`, [v.id]);
    await sql(`DELETE FROM "ProductCategory" WHERE id = $1`, [c.id]);
    await sql(`DELETE FROM "User" WHERE id = ANY($1::uuid[])`, [[seller, buyer]]);
  }
});

test('a service partner: services, opening hours and LocalBusiness structured data', async ({
  page,
}) => {
  const slug = await one(
    `SELECT slug AS v FROM "ServicePartner" WHERE status = 'APPROVED' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  test.skip(!slug, 'This database has none to show');
  await page.goto(`/service/${slug}`);
  await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Monday' })).toBeVisible();
  const [ld] = await jsonLd(page);
  expect(ld['@type']).toBe('LocalBusiness');
  expect(ld.address.addressCountry).toBe('IN');
  expect(ld.makesOffer.length).toBeGreaterThan(0);
});

test('a contest: stage, prizes and an online Event', async ({ page }) => {
  const slug = await one(
    `SELECT slug AS v FROM "Contest" WHERE status IN ('SCHEDULED','LIVE','VOTING','COMPLETED','WINNER_DECLARATION') ORDER BY "createdAt" DESC LIMIT 1`,
  );
  test.skip(!slug, 'This database has none to show');
  await page.goto(`/contest/${slug}`);
  await expect(page.getByText(/Entries|Voting|results|winners/i).first()).toBeVisible();
  const [ld] = await jsonLd(page);
  expect(ld['@type']).toBe('Event');
  expect(ld.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode');
});

test('old share links move to /reel, and unknown things are a real 404', async ({
  page,
  request,
}) => {
  const id = await one(
    `SELECT id::text AS v FROM "Post" WHERE status = 'PUBLISHED' AND visibility = 'PUBLIC' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
  );
  test.skip(!id, 'This database has none to show');
  const r = await request.get(`/p/${id}`, { maxRedirects: 0 });
  expect(r.status()).toBe(308);
  expect(r.headers().location).toBe(`/reel/${id}`);
  await page.goto(`/reel/${id}`);
  await expect(page.getByRole('link', { name: 'Open in PetApp' })).toHaveAttribute(
    'href',
    `petapp://reel/${id}`,
  );
  for (const path of ['/product/no-such-thing', '/reel/not-a-uuid', '/legal/../../etc'])
    expect((await request.get(path)).status()).toBe(404);
});

test('bookings are private: the page only hands over to the app and is never indexed', async ({
  page,
}) => {
  await page.goto('/booking/7b1c0b39-5d8a-4c1f-9e0f-2f3c3a1d9e11');
  await expect(page.getByRole('heading', { name: 'Your booking' })).toBeVisible();
  expect(await meta(page, 'meta[name="robots"]')).toContain('noindex');
});

test('sitemap, robots and the app association files', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  // The sitemap is cached for a few minutes, so check against a pet the API already lists.
  const listed = (
    await (
      await request.get(`${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/public/sitemap`)
    ).json()
  ).data.pets[0].key;
  expect(xml).toContain(`/pet/${listed}</loc>`);
  expect(xml).not.toContain(privatePet);
  expect(xml).not.toContain(friendsPet);
  expect(xml).toMatch(/\/legal\/[a-z-]+<\/loc>/);
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  expect(robots).toContain('Disallow: /booking/');

  const android = await (await request.get('/.well-known/assetlinks.json')).json();
  expect(android[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
  expect(android[0].target.package_name).toBeTruthy();
  const aasa = await request.get('/.well-known/apple-app-site-association');
  expect(aasa.headers()['content-type']).toContain('application/json');
  const paths = (await aasa.json()).applinks.details[0].components.map(
    (c: { '/': string }) => c['/'],
  );
  expect(paths).toEqual([
    '/pet/*',
    '/reel/*',
    '/contest/*',
    '/challenge/*',
    '/product/*',
    '/service/*',
    '/booking/*',
  ]);
});

test('legal documents read well as web pages', async ({ page }) => {
  await page.goto('/legal');
  const first = page.locator('main a').first();
  const name = (await first.locator('span').first().innerText()).trim();
  await first.click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(1);
  await expect(page.getByRole('contentinfo').getByRole('link', { name })).toBeVisible();
});

test('the account-deletion page app stores ask for', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Delete your account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Delete your account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Without the app' })).toBeVisible();
  await expect(page.getByText('Kept without your profile')).toBeVisible();
});

test('the help center: answers open in place, with FAQ structured data', async ({ page, request }) => {
  const api = process.env.API_URL ?? 'http://localhost:4000';
  const faqs = ((await (await request.get(`${api}/api/v1/support/faqs?app=customer`)).json()).data.faqs as Array<{ question: string }>);
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Help' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Help and support' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Still need help?' })).toBeVisible();
  if (!faqs.length) return; // nothing published on this database
  await page.locator('summary', { hasText: faqs[0].question }).first().click();
  await expect(page.locator('details[open]')).toHaveCount(1);
  const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
  expect(ld.some((s) => s.includes('"FAQPage"'))).toBe(true);
});
