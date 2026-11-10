import { test as setup } from '@playwright/test';
import { signIn } from './helpers';

setup('sign in once for the suite', async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});
