import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Resets the TEST database to the committed migrations before the e2e run.
 * Set E2E_SKIP_MIGRATE=1 if you manage the test schema yourself.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_MIGRATE === '1') return;
  const url = process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/petapp_test';
  if (!/test/i.test(url)) throw new Error(`Refusing to reset a database whose URL does not contain "test": ${url}`);
  execSync('npx prisma migrate reset --force', {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
