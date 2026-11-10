#!/usr/bin/env node
// Go-live preflight: is this production configuration really ready? Checks the environment file the servers will
// use, and (with --api and an admin token) the live platform: published policies, company details for invoices,
// connected providers.
//
//   node scripts/ops/preflight.mjs --env-file prod.env
//   node scripts/ops/preflight.mjs --env-file prod.env --api https://api.petapp.in --admin-token <token>
//
// "FAIL" blocks the launch; "WARN" is worth a look. Exit code 1 when anything fails.
import { readFile } from 'node:fs/promises';
import { flags } from './lib.mjs';

const f = flags();
if (!f['env-file']) {
  console.error('Usage: node scripts/ops/preflight.mjs --env-file <production .env> [--api <url> --admin-token <token>]');
  process.exit(2);
}
const env = {};
for (const line of (await readFile(f['env-file'], 'utf8')).split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !line.trimStart().startsWith('#')) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
const results = [];
const out = (level, name, detail = '') => {
  results.push(level);
  console.log(`${level.padEnd(4)}  ${name}${detail ? `: ${detail}` : ''}`);
};
const ok = (cond, name, detail, level = 'FAIL') => out(cond ? 'PASS' : level, name, cond ? '' : detail);
const has = (k) => Boolean(env[k] && env[k].trim());
const https = (k) => has(k) && /^https:\/\//.test(env[k]);

console.log('— Configuration');
ok(env.NODE_ENV === 'production', 'NODE_ENV is production', `it is "${env.NODE_ENV ?? ''}"`);
for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) ok((env[k] ?? '').length >= 48, `${k} is long and random`, 'use at least 48 characters (see docs/runbooks/rotate-secrets.md)');
ok(env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, 'Access and refresh secrets differ', 'they are the same');
ok((env.OTP_PEPPER ?? '').length >= 24, 'OTP_PEPPER is long and random', 'use at least 24 characters');
ok(/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? '') && /sslmode=(require|verify)/.test(env.DATABASE_URL ?? ''), 'Database connection uses TLS', 'add ?sslmode=require (or verify-full) to DATABASE_URL', 'WARN');
ok(/^rediss:\/\//.test(env.REDIS_URL ?? ''), 'Redis connection uses TLS', 'use a rediss:// URL if your provider supports it', 'WARN');
ok(env.SWAGGER_ENABLED !== 'true', 'API reference (Swagger) is off', 'set SWAGGER_ENABLED=false');
ok(!has('RATE_LIMIT_MULTIPLIER') || env.RATE_LIMIT_MULTIPLIER === '1', 'Rate limits are normal', 'remove RATE_LIMIT_MULTIPLIER (load tests only)');
ok(has('CORS_ORIGINS') && !/localhost|\*/.test(env.CORS_ORIGINS), 'CORS allows only your sites', `CORS_ORIGINS is "${env.CORS_ORIGINS ?? ''}"`);
ok(env.TRUST_PROXY === 'true' || /^\d+$/.test(env.TRUST_PROXY ?? ''), 'TRUST_PROXY is set behind the load balancer', 'without it, rate limits and audit logs see the load balancer’s address', 'WARN');

console.log('\n— Providers');
ok(env.SMS_PROVIDER === 'smslocal' && has('SMSLOCAL_DLT_TEMPLATE_ID'), 'SMS sends real codes with a DLT template', 'set SMS_PROVIDER=smslocal and SMSLOCAL_DLT_TEMPLATE_ID');
ok(env.PAYMENT_PROVIDER === 'razorpay', 'Payments use Razorpay', 'PAYMENT_PROVIDER must be razorpay');
ok(/^rzp_live_/.test(env.RAZORPAY_KEY_ID ?? ''), 'Razorpay live keys', 'RAZORPAY_KEY_ID is not a live key (rzp_live_…)');
ok(has('RAZORPAY_WEBHOOK_SECRET'), 'Razorpay webhook secret is set', 'set RAZORPAY_WEBHOOK_SECRET');
ok(env.PAYOUT_PROVIDER === 'razorpayx' && has('RAZORPAYX_ACCOUNT_NUMBER'), 'Payouts use RazorpayX', 'set PAYOUT_PROVIDER=razorpayx and its keys');
ok((env.PAYOUT_DATA_KEY ?? '').length >= 32, 'Bank details are encrypted with your own key', 'set PAYOUT_DATA_KEY (it must never change without re-encrypting)');
ok(env.PUSH_PROVIDER === 'fcm', 'Push notifications use Firebase', 'set PUSH_PROVIDER=fcm and the FCM_* keys', 'WARN');
ok(has('S3_BUCKET') && has('S3_ACCESS_KEY_ID'), 'Object storage is configured', 'set S3_BUCKET and its keys');
ok(https('MEDIA_PUBLIC_BASE_URL'), 'Photos are served from a CDN', 'set MEDIA_PUBLIC_BASE_URL to an https CDN (signed links expire, and cost CPU)');
if (env.AI_PROVIDER === 'anthropic') ok(has('ANTHROPIC_API_KEY'), 'AI provider key is set', 'AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');

console.log('\n— Monitoring and backups');
ok(env.ERROR_TRACKER === 'sentry' && https('SENTRY_DSN'), 'Errors are reported', 'set ERROR_TRACKER=sentry and SENTRY_DSN');
ok((env.METRICS_TOKEN ?? '').length >= 16, 'Metrics are protected by a token', 'set METRICS_TOKEN and use it in Prometheus');
ok(env.LOG_FORMAT !== 'pretty', 'Logs are JSON', 'remove LOG_FORMAT=pretty');
ok(has('BACKUP_BUCKET') && env.BACKUP_BUCKET !== env.S3_BUCKET, 'Backups go to their own bucket', 'set BACKUP_BUCKET (not the media bucket), ideally in another account or region');
ok(has('BACKUP_ENCRYPTION_KEY'), 'Backups are encrypted with your key', 'set BACKUP_ENCRYPTION_KEY and keep it apart from the backups', 'WARN');

console.log('\n— Website and app links');
ok(https('SITE_URL'), 'The website has an https address', 'set SITE_URL');
ok(env.SITE_INDEXABLE === 'true', 'Search engines may index the website', 'set SITE_INDEXABLE=true on production only');
ok(has('ANDROID_PACKAGE_NAME') && has('ANDROID_SHA256_FINGERPRINTS'), 'Android App Links are configured', 'set ANDROID_PACKAGE_NAME and ANDROID_SHA256_FINGERPRINTS');
ok(/^[A-Z0-9]{10}\./.test(env.IOS_APP_ID ?? ''), 'iOS Universal Links are configured', 'set IOS_APP_ID (TEAMID.bundle.id)');
ok(has('PLAY_STORE_URL') || has('APP_STORE_URL'), 'Store links are set', 'set PLAY_STORE_URL and APP_STORE_URL once the listings exist', 'WARN');
ok(has('SUPPORT_EMAIL'), 'Support email for account deletion is set', 'set SUPPORT_EMAIL (the stores need /account-deletion to offer it)');

if (f.api) {
  console.log('\n— Live platform');
  const api = f.api.replace(/\/$/, '');
  const get = async (p, auth) => {
    const r = await fetch(`${api}/api/v1${p}`, { headers: auth && f['admin-token'] ? { Authorization: `Bearer ${f['admin-token']}` } : {} });
    if (!r.ok) throw new Error(`${p} answered ${r.status}`);
    return (await r.json()).data;
  };
  try {
    const docs = (await get('/legal')).map((d) => d.slug);
    for (const s of ['terms-of-service', 'privacy-policy', 'refund-policy', 'cancellation-policy']) ok(docs.includes(s), `${s} is published`, 'publish it in Configuration → Legal documents');
    for (const s of ['contest-terms', 'partner-terms', 'vendor-terms', 'community-guidelines']) ok(docs.includes(s), `${s} is published`, 'publish it before the matching feature goes live', 'WARN');
  } catch (e) {
    out('FAIL', 'Legal documents', e.message);
  }
  if (f['admin-token']) {
    try {
      const settings = Object.fromEntries((await get('/admin/settings', true)).map((s) => [s.key, s.value]));
      for (const k of ['company.legalName', 'company.gstin', 'company.pan', 'company.address', 'invoice.commissionSac']) ok(Boolean(settings[k]), `${k} is filled in (printed on invoices)`, 'set it in Features & settings');
      const sys = await get('/admin/system', true);
      const fake = Object.entries(sys.providers ?? {}).filter(([, v]) => ['fake', 'console', 'none', 'not set', 'no token'].includes(String(v)));
      ok(!fake.length, 'Every connected service is a real one', fake.map(([k, v]) => `${k}: ${v}`).join(', '), fake.some(([k]) => ['payments', 'payouts', 'sms'].includes(k)) ? 'FAIL' : 'WARN');
      const down = Object.entries(sys.checks ?? {}).filter(([, c]) => !c.ok).map(([k]) => k);
      ok(!down.length, 'Database, Redis and storage are up', down.join(', '));
    } catch (e) {
      out('FAIL', 'Admin checks', e.message);
    }
  } else out('WARN', 'Admin checks skipped', 'pass --admin-token to check company details and providers');
}

const fails = results.filter((r) => r === 'FAIL').length;
const warns = results.filter((r) => r === 'WARN').length;
console.log(`\n${fails ? `${fails} blocking problem(s)` : 'Ready'}${warns ? `, ${warns} warning(s)` : ''}.`);
process.exit(fails ? 1 : 0);
