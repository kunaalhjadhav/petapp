import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the public website. Needs the API (with data) and this site running:
 *   SITE_URL=http://localhost:3001 SITE_INDEXABLE=true ANDROID_PACKAGE_NAME=… IOS_APP_ID=… npm run start
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: process.env.WEB_URL ?? 'http://localhost:3001', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec\.ts/ },
  ],
});
