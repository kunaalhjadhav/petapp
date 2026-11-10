#!/usr/bin/env node
// Restore drill: restores a backup into a fresh scratch database and proves it is complete and consistent.
//
//   node scripts/ops/restore-drill.mjs                          # the latest backup in BACKUP_BUCKET
//   node scripts/ops/restore-drill.mjs --manifest ./backups/petapp-….json   # a local backup
//   node scripts/ops/restore-drill.mjs --keep                   # leave the scratch database for inspection
//   node scripts/ops/restore-drill.mjs --report drill.json      # also write the results as JSON
//
// RESTORE_ADMIN_URL: a Postgres server and user that may CREATE DATABASE (default: DATABASE_URL's server, "postgres"
// database). Point it at a separate restore instance in production, never at the live primary.
// Checks: the file's checksum; every table's row count against the manifest; the ledger totals and that every ledger
// transaction balances; the database rules that protect money and consent; applied migrations against the repo.
// Exit code 1 if anything doesn't match. Run it every quarter and record the time against the RTO (1 hour).
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { backupStore, decryptFile, encryptionKey, flags, libpqUrl, loadEnvFile, mb, need, pgOptions, run, sha256File, stamp } from './lib.mjs';

await loadEnvFile('.env');
const f = flags();
const started = Date.now();
const work = await mkdtemp(join(tmpdir(), 'petapp-drill-'));
const results = [];
const check = (name, ok, detail = '', warnOnly = false) => {
  const status = ok ? 'pass' : warnOnly ? 'warn' : 'fail';
  results.push({ name, ok: ok || warnOnly, status, detail });
  console.log(`${status.toUpperCase().padEnd(4)}  ${name}${detail ? `: ${detail}` : ''}`);
};

const adminUrl = process.env.RESTORE_ADMIN_URL ?? (() => {
  const u = new URL(need('DATABASE_URL'));
  u.pathname = '/postgres';
  return u.toString();
})();
const scratch = `petapp_restore_${stamp().toLowerCase().replace(/[^a-z0-9]/g, '_')}`.slice(0, 60);
const scratchUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${scratch}`;
  return u.toString();
})();

let manifest;
let file;
let exitCode = 0;
try {
  // 1. Find and fetch the backup.
  if (f.manifest) {
    manifest = JSON.parse(await readFile(f.manifest, 'utf8'));
    file = join(dirname(f.manifest), manifest.file);
  } else {
    const { client, bucket, prefix } = backupStore();
    let token;
    let latest = null;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) if (o.Key.endsWith('/manifest.json') && (!latest || o.Key > latest)) latest = o.Key;
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    if (!latest) throw new Error(`No backups found in s3://${bucket}/${prefix}`);
    const body = await client.send(new GetObjectCommand({ Bucket: bucket, Key: latest }));
    manifest = JSON.parse(await body.Body.transformToString());
    file = join(work, manifest.file);
    const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: latest.replace(/manifest\.json$/, manifest.file) }));
    await pipeline(obj.Body, createWriteStream(file));
    console.log(`Latest backup: ${latest.replace(/\/manifest\.json$/, '')} (${mb(manifest.sizeBytes)}, taken ${manifest.createdAt})`);
  }
  check('Checksum matches the manifest', (await sha256File(file)) === manifest.sha256);
  if (manifest.encrypted) {
    const key = encryptionKey();
    if (!key) throw new Error('This backup is encrypted: set BACKUP_ENCRYPTION_KEY');
    const plain = join(work, 'restore.dump');
    await decryptFile(file, plain, key);
    file = plain;
    check('Decrypted with BACKUP_ENCRYPTION_KEY', true);
  }

  // 2. Restore into a brand-new database.
  const admin = new pg.Client(pgOptions(adminUrl));
  await admin.connect();
  if (new URL(need('DATABASE_URL')).pathname === `/${scratch}`) throw new Error('Refusing to restore over the live database');
  await admin.query(`CREATE DATABASE "${scratch}"`);
  await admin.end();
  const restoreStart = Date.now();
  await run('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', await libpqUrl(scratchUrl, dirname(file)), file]);
  const restoreSeconds = Math.round((Date.now() - restoreStart) / 1000);
  check('pg_restore finished without errors', true, `${restoreSeconds}s`);

  // 3. Prove it's all there and consistent.
  const db = new pg.Client(pgOptions(scratchUrl));
  await db.connect();
  const mismatched = [];
  for (const [table, expected] of Object.entries(manifest.tables)) {
    const n = Number((await db.query(`SELECT count(*)::bigint AS n FROM "${table.replace(/"/g, '""')}"`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n);
    if (n !== expected) mismatched.push(`${table} ${n}/${expected}`);
  }
  const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  check(`Every table has its rows (${Object.keys(manifest.tables).length} tables, ${total.toLocaleString('en-IN')} rows)`, mismatched.length === 0, mismatched.slice(0, 10).join(', '));

  if (manifest.ledger) {
    const l = (await db.query(`SELECT COALESCE(SUM("debitPaise"),0)::bigint AS d, COALESCE(SUM("creditPaise"),0)::bigint AS c FROM "LedgerEntry"`)).rows[0];
    check('Ledger totals match the backup', Number(l.d) === manifest.ledger.debitPaise && Number(l.c) === manifest.ledger.creditPaise, `debits ₹${(Number(l.d) / 100).toLocaleString('en-IN')}`);
    const unbalanced = Number((await db.query(`SELECT count(*)::bigint AS n FROM (SELECT "transactionId" FROM "LedgerEntry" GROUP BY "transactionId" HAVING SUM("debitPaise") <> SUM("creditPaise")) x`)).rows[0].n);
    check('Every ledger transaction balances', unbalanced === 0, unbalanced ? `${unbalanced} unbalanced` : '');
  }

  // Database rules the application relies on: they must survive a restore.
  const rules = [
    ['trigger', 'consent_record_no_update', `SELECT 1 FROM pg_trigger WHERE tgname = $1`],
    ['index', 'LegalDocument_one_published', `SELECT 1 FROM pg_indexes WHERE indexname = $1`],
    ['index', 'PayoutAccount_one_verified_per_owner', `SELECT 1 FROM pg_indexes WHERE indexname = $1`],
    ['index', 'Payout_one_open_per_payee', `SELECT 1 FROM pg_indexes WHERE indexname = $1`],
    ['extension', 'postgis', `SELECT 1 FROM pg_extension WHERE extname = $1`],
  ];
  const missing = [];
  for (const [kind, name, q] of rules) if (!(await db.query(q, [name])).rowCount) missing.push(`${kind} ${name}`);
  check('Money and consent safeguards are in place', missing.length === 0, missing.join(', '));

  const repo = (await readdir('prisma/migrations', { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  if (manifest.migrations) {
    const notApplied = repo.filter((m) => !manifest.migrations.includes(m));
    check('Every migration in this release is applied', notApplied.length === 0, notApplied.length ? `${notApplied.length} pending (run npm run db:deploy after restoring): ${notApplied.join(', ')}` : `${repo.length} migrations`);
  } else {
    // A warning, not a failure: development databases built by hand have no history. Production must have one.
    check('Migration history present', false, 'no _prisma_migrations table: this database was not set up with `prisma migrate deploy`', true);
  }
  await db.end();
} catch (e) {
  check('Drill ran to the end', false, e.message);
} finally {
  if (!f.keep) {
    const admin = new pg.Client(pgOptions(adminUrl));
    await admin.connect().then(() => admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`)).catch(() => undefined);
    await admin.end().catch(() => undefined);
  } else console.log(`Kept the restored database: ${scratch}`);
  await rm(work, { recursive: true, force: true });
}

const seconds = Math.round((Date.now() - started) / 1000);
const failed = results.filter((r) => r.status === 'fail');
const rto = 3600;
console.log(`\n${failed.length ? `${failed.length} check(s) failed` : 'All checks passed'}. Whole drill took ${seconds}s (target: under ${rto / 60} minutes).`);
if (f.report) await writeFile(f.report, JSON.stringify({ backup: manifest?.name, ranAt: new Date(started).toISOString(), seconds, withinRto: seconds <= rto, results }, null, 2));
if (failed.length) exitCode = 1;
process.exit(exitCode);
