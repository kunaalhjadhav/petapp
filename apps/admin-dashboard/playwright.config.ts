import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a running dashboard + API with seeded demo data.
 * Start both first (see README), then: npm run test:e2e -w @petapp/admin-dashboard
 *
 * Tests share one signed-in session (auth.setup.ts) so the suite stays inside the admin
 * sign-in rate limit (5 per minute); only tests about sign-in itself log in again.
 */
const STATE = 'e2e/.auth/admin.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.DASHBOARD_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : undefined,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['setup'],
      testIgnore: /mobile\.spec\.ts|auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: STATE,
      },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'], storageState: STATE },
    },
  ],
});
