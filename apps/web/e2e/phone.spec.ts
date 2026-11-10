import { expect, test } from '@playwright/test';
import { one } from './data';

/** On a phone: nothing scrolls sideways, and "Open in PetApp" stays in reach. */
test('pages fit a phone screen', async ({ page }) => {
  const product = await one(
    `SELECT p.slug AS v FROM "Product" p JOIN "Vendor" v ON v.id = p."vendorId" WHERE p.status = 'ACTIVE' AND v.status = 'APPROVED' LIMIT 1`,
  );
  test.skip(!product, 'This database has none to show');
  const service = await one(
    `SELECT slug AS v FROM "ServicePartner" WHERE status = 'APPROVED' LIMIT 1`,
  );
  test.skip(!service, 'This database has none to show');
  for (const path of ['/', `/product/${product}`, `/service/${service}`, '/legal']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto(`/service/${service}`);
  await expect(page.getByRole('link', { name: 'Open in PetApp' })).toBeInViewport();
  // The styles loaded: the bar is fixed to the bottom and the button is collar teal.
  await expect(page.getByRole('link', { name: 'Open in PetApp' })).toHaveCSS('background-color', 'rgb(29, 92, 88)');
});
