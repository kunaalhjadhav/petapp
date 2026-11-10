// Shared helpers for the operations scripts (backups, restore drill, smoke tests, preflight).
// Plain Node 22, no build step: run from the repo root, e.g. `node scripts/ops/backup.mjs`.
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { readFile, stat } from 'node:fs/promises';
import { S3Client } from '@aws-sdk/client-s3';

/** Loads KEY=value lines from a file into process.env (without overwriting what's already set). */
export async function loadEnvFile(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return false;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return true;
}

export function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Command-line flags: --name value, --flag */
export function flags(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

/** Runs a program, streaming its errors; rejects on a non-zero exit. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(-800)}`))));
  });
}

/** Object storage for backups: BACKUP_S3_* if set, otherwise the app's S3_* settings. */
export function backupStore() {
  const e = (k) => process.env[`BACKUP_${k}`] ?? process.env[k];
  const bucket = process.env.BACKUP_BUCKET;
  if (!bucket) throw new Error('BACKUP_BUCKET is not set (use a bucket separate from media, ideally in another region or account)');
  const client = new S3Client({
    region: e('S3_REGION') ?? 'ap-south-1',
    endpoint: e('S3_ENDPOINT') || undefined,
    forcePathStyle: e('S3_FORCE_PATH_STYLE') === 'true',
    credentials: e('S3_ACCESS_KEY_ID') ? { accessKeyId: e('S3_ACCESS_KEY_ID'), secretAccessKey: e('S3_SECRET_ACCESS_KEY') } : undefined,
  });
  return { client, bucket, prefix: (process.env.BACKUP_PREFIX ?? 'postgres/').replace(/^\/+/, '') };
}

export async function sha256File(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

/** The optional client-side encryption key (32 bytes, base64). Without it, backups rely on the bucket's own encryption. */
export function encryptionKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

/** AES-256-GCM. Output: "PABK1" + 12-byte IV + ciphertext + 16-byte tag. */
export async function encryptFile(src, dst, key) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(dst);
  out.write(Buffer.concat([Buffer.from('PABK1'), iv]));
  await pipeline(createReadStream(src), c, out, { end: false });
  await new Promise((resolve, reject) => out.end(c.getAuthTag(), (e) => (e ? reject(e) : resolve())));
}

export async function decryptFile(src, dst, key) {
  const { size } = await stat(src);
  const fd = await import('node:fs/promises').then((m) => m.open(src, 'r'));
  const head = Buffer.alloc(17);
  const tag = Buffer.alloc(16);
  await fd.read(head, 0, 17, 0);
  await fd.read(tag, 0, 16, size - 16);
  await fd.close();
  if (head.subarray(0, 5).toString() !== 'PABK1') throw new Error('Not an encrypted PetApp backup');
  const d = createDecipheriv('aes-256-gcm', key, head.subarray(5, 17));
  d.setAuthTag(tag);
  await pipeline(createReadStream(src, { start: 17, end: size - 17 }), d, createWriteStream(dst));
}

export const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
export const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ── Managed databases with their own TLS certificate authority (DATABASE_CA_CERT) ──
// Same rules as apps/backend/src/prisma/pg-connection.ts: verify against the provider's CA when it's given.
const TLS_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'sslaccept'];
export function caCert() {
  const t = process.env.DATABASE_CA_CERT?.trim();
  if (!t) return undefined;
  const pem = (t.includes('-----BEGIN') ? t.replace(/\\n/g, '\n') : Buffer.from(t, 'base64').toString('utf8')).trim();
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error('DATABASE_CA_CERT is not a PEM certificate');
  return pem;
}
/** Options for node-postgres. */
export function pgOptions(url) {
  const ca = caCert();
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  for (const k of TLS_PARAMS) u.searchParams.delete(k);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}
/** A URL for pg_dump / pg_restore (libpq): with a CA, full verification against a copy of it written to `dir`. */
export async function libpqUrl(url, dir) {
  const ca = caCert();
  if (!ca) {
    // libpq refuses parameters it doesn't know (Prisma's sslaccept, node-postgres's uselibpqcompat).
    const u = new URL(url);
    for (const k of ['sslaccept', 'uselibpqcompat']) u.searchParams.delete(k);
    return u.toString();
  }
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const file = join(dir, 'db-ca.pem');
  await writeFile(file, ca + '\n', { mode: 0o600 });
  const u = new URL(url);
  for (const k of TLS_PARAMS) u.searchParams.delete(k);
  u.searchParams.set('sslmode', 'verify-full');
  u.searchParams.set('sslrootcert', file);
  return u.toString();
}

