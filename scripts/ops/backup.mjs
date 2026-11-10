#!/usr/bin/env node
// Logical backup of the PetApp database, with a manifest that the restore drill checks against.
//
//   node scripts/ops/backup.mjs                 # dump, upload to BACKUP_BUCKET, prune old backups
//   node scripts/ops/backup.mjs --out ./backups # keep the files locally instead (no upload)
//
// Settings: DATABASE_URL; BACKUP_BUCKET (+ optional BACKUP_PREFIX, BACKUP_S3_* credentials, else the app's S3_*);
// BACKUP_KEEP_DAYS (35); BACKUP_ENCRYPTION_KEY (optional, 32 bytes base64: encrypts the file before upload);
// BACKUP_HEARTBEAT_URL (optional: pinged after each successful backup, e.g. a healthchecks.io check that alerts
// you when a night's backup doesn't arrive).
//
// Managed Postgres snapshots and point-in-time recovery stay the first line of defence; this is the independent copy
// (another bucket, ideally another region or account) and the thing the quarterly restore drill restores.
import { mkdtemp, mkdir, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { backupStore, encryptFile, encryptionKey, flags, libpqUrl, loadEnvFile, mb, need, pgOptions, run, sha256File, stamp } from './lib.mjs';

await loadEnvFile('.env');
const f = flags();
const url = need('DATABASE_URL');
const started = Date.now();
const name = `petapp-${stamp()}`;
const work = await mkdtemp(join(tmpdir(), 'petapp-backup-'));

try {
  // One snapshot for both the counts and the dump, so the manifest describes exactly what is in the file.
  const db = new pg.Client(pgOptions(url));
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const { rows: [{ snap }] } = await db.query('SELECT pg_export_snapshot() AS snap');
  const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys' ORDER BY tablename`)).rows.map((r) => r.tablename);
  const counts = {};
  for (const t of tables) counts[t] = Number((await db.query(`SELECT count(*)::bigint AS n FROM "${t.replace(/"/g, '""')}"`)).rows[0].n);
  const ledger = tables.includes('LedgerEntry')
    ? (await db.query(`SELECT COALESCE(SUM("debitPaise"),0)::bigint AS debit, COALESCE(SUM("creditPaise"),0)::bigint AS credit FROM "LedgerEntry"`)).rows[0]
    : null;
  const migrations = tables.includes('_prisma_migrations')
    ? (await db.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`)).rows.map((r) => r.migration_name)
    : null;
  const server = (await db.query('SHOW server_version')).rows[0].server_version;

  const dump = join(work, `${name}.dump`);
  await run('pg_dump', ['--format=custom', '--compress=6', '--no-owner', '--no-acl', `--snapshot=${snap}`, '--file', dump, await libpqUrl(url, work)]);
  await db.query('COMMIT');
  await db.end();

  const key = encryptionKey();
  let file = dump;
  if (key) {
    file = `${dump}.enc`;
    await encryptFile(dump, file, key);
  }
  const { size } = await stat(file);
  const manifest = {
    name,
    createdAt: new Date(started).toISOString(),
    file: file.split(/[\\/]/).pop(),
    sizeBytes: size,
    sha256: await sha256File(file),
    encrypted: Boolean(key),
    format: 'pg_dump custom',
    postgres: server,
    tables: counts,
    ledger: ledger && { debitPaise: Number(ledger.debit), creditPaise: Number(ledger.credit) },
    migrations,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  await writeFile(join(work, `${name}.json`), JSON.stringify(manifest, null, 2));

  if (f.out) {
    await mkdir(f.out, { recursive: true });
    await copyFile(file, join(f.out, manifest.file));
    await copyFile(join(work, `${name}.json`), join(f.out, `${name}.json`));
    console.log(`Backup written to ${f.out}: ${manifest.file} (${mb(size)}, ${Object.keys(counts).length} tables)`);
  } else {
    const { client, bucket, prefix } = backupStore();
    const day = manifest.createdAt.slice(0, 10).replace(/-/g, '/');
    const base = `${prefix}${day}/${name}`;
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${base}/${manifest.file}`, Body: createReadStream(file), ContentLength: size, ServerSideEncryption: 'AES256' }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${base}/manifest.json`, Body: JSON.stringify(manifest, null, 2), ContentType: 'application/json', ServerSideEncryption: 'AES256' }));
    console.log(`Backup uploaded to s3://${bucket}/${base}/ (${mb(size)}, ${Object.keys(counts).length} tables, ${manifest.seconds}s)`);

    // Prune: whole backups older than BACKUP_KEEP_DAYS. Use the bucket's own lifecycle rules too, if you prefer.
    const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 35);
    const cutoff = Date.now() - keepDays * 86_400_000;
    let token;
    const old = [];
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) if (o.LastModified && o.LastModified.getTime() < cutoff) old.push({ Key: o.Key });
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    for (let i = 0; i < old.length; i += 1000) await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: old.slice(i, i + 1000), Quiet: true } }));
    if (old.length) console.log(`Removed ${old.length} objects older than ${keepDays} days`);
  }
  if (process.env.BACKUP_HEARTBEAT_URL) await fetch(process.env.BACKUP_HEARTBEAT_URL, { signal: AbortSignal.timeout(10_000) }).catch((e) => console.warn(`Heartbeat failed: ${e.message}`));
} finally {
  await rm(work, { recursive: true, force: true });
}
