#!/usr/bin/env node
/**
 * PetApp on Render's free plan (see render.yaml and docs/RENDER.md).
 *
 * Free web services can't run a pre-deploy command, and background workers aren't free, so this one service:
 *   1. waits for the database (a free database may be waking up),
 *   2. applies the database migrations (`prisma migrate deploy`; nothing to do on most starts),
 *   3. seeds the database the first time (roles, settings, locations, your admin, and demo data if asked),
 *   4. runs the API and the background worker together in one Node process (scripts/render/api-and-worker.cjs):
 *      about 210 MB at rest, where two processes would need about 440 MB of the free plan's 512 MB.
 *
 * ENABLE_ALL_FEATURES=true switches every feature on at the first seed (paid voting stays off); change them later
 * in the dashboard under Settings → Feature switches.
 *
 * Settings: RUN_WORKER=false runs the API alone. RESEED=true runs the seed again (it is safe to repeat).
 * HEAP_MB caps the JavaScript heap (default 300).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import pg from 'pg';

const env = process.env;
const require = createRequire(import.meta.url);
const { pgConnection } = require('../../apps/backend/dist/prisma/pg-connection.js');
const log = (m) => console.log(`[render-start] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!env.DATABASE_URL) {
  log('DATABASE_URL is not set. In Render, link the database (render.yaml does this) and deploy again.');
  process.exit(1);
}

async function query(sql) {
  const c = new pg.Client(pgConnection(env.DATABASE_URL, env.DATABASE_CA_CERT));
  await c.connect();
  try {
    return (await c.query(sql)).rows;
  } finally {
    await c.end();
  }
}

async function waitForDatabase() {
  for (let i = 1; i <= 40; i++) {
    try {
      await query('SELECT 1');
      return;
    } catch (e) {
      log(`waiting for the database (${i}/40): ${e.message}`);
      await sleep(3000);
    }
  }
  throw new Error('the database did not answer for two minutes');
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env });
  return r.status === 0;
}

async function migrate() {
  for (let i = 1; i <= 3; i++) {
    if (run('npx', ['prisma', 'migrate', 'deploy'])) return;
    log(`migrations failed (try ${i}/3)`);
    await sleep(5000);
  }
  throw new Error('migrations failed; see the lines above');
}

async function needsSeed() {
  if (env.RESEED === 'true') return true;
  try {
    const [{ n }] = await query('SELECT count(*)::int AS n FROM "Role"');
    return n === 0;
  } catch {
    return true;
  }
}

function seed() {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are not set: seeding without a dashboard admin. Set them and RESEED=true to add one.');
  }
  // A seed problem (say, a weak admin password) is reported but doesn't keep the API down.
  if (!run('npx', ['tsx', 'prisma/seed/seed.ts'])) log('SEEDING FAILED: read the lines above, fix the setting, then deploy again with RESEED=true.');
}

const children = [];
for (const s of ['SIGTERM', 'SIGINT']) {
  process.on(s, () => {
    for (const c of children) if (c.exitCode === null) c.kill(s);
  });
}

try {
  await waitForDatabase();
  await migrate();
  if (await needsSeed()) {
    log('seeding the database');
    seed();
    if (env.ENABLE_ALL_FEATURES === 'true') {
      const on = await query(`UPDATE "FeatureFlag" SET enabled = true, "updatedAt" = now() WHERE key LIKE 'ENABLE\\_%' AND key <> 'ENABLE_PAID_VOTING' RETURNING key`);
      log(`switched on: ${on.map((r) => r.key).join(', ') || 'nothing (no feature switches found)'}`);
    }
  }
} catch (e) {
  log(`cannot start: ${e.message}`);
  process.exit(1);
}

if (env.RUN_WORKER === 'false') log('RUN_WORKER=false: background jobs (video processing, reminders, refunds) are not running');
const app = spawn('node', [`--max-old-space-size=${Number(env.HEAP_MB ?? 300)}`, 'scripts/render/api-and-worker.cjs'], { stdio: 'inherit', env });
children.push(app);
app.on('exit', (code, signal) => {
  log(`the API stopped (${signal ?? code}); Render restarts the service`);
  process.exit(code ?? 1);
});
