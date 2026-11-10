#!/usr/bin/env node
// Smoke test of a running deployment: is everything up, wired together, and safe?
//
//   node scripts/ops/smoke.mjs --api https://api.petapp.in --web https://petapp.in --admin https://admin.petapp.in --env production
//   node scripts/ops/smoke.mjs                       # local defaults: :4000, :3001, :3000, development
//
// Exit code 1 if any check fails. The deploy workflow runs it after every deploy.
import { flags } from './lib.mjs';

const f = flags();
const api = (f.api || 'http://localhost:4000').replace(/\/$/, '');
const web = (f.web || 'http://localhost:3001').replace(/\/$/, '');
const admin = (f.admin || 'http://localhost:3000').replace(/\/$/, '');
const env = f.env || 'development';
const live = env === 'production' || env === 'staging';
const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? `: ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}
async function req(url, init = {}) {
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), ...init });
  return r;
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

await check('API is alive', async () => expect((await req(`${api}/health`)).ok, 'GET /health did not answer 200'));
await check('API is ready (database, Redis, storage)', async () => {
  const r = await req(`${api}/ready`);
  const body = await r.json().catch(() => ({}));
  const checks = body?.data?.checks ?? {};
  const down = Object.entries(checks).filter(([, c]) => !c.ok).map(([k]) => k);
  expect(r.ok && !down.length, down.length ? `down: ${down.join(', ')}` : `answered ${r.status}`);
  return Object.entries(checks).map(([k, c]) => `${k} ${c.ms} ms`).join(', ');
});
await check('Public API answers (legal documents, feature switches)', async () => {
  for (const p of ['/api/v1/legal', '/api/v1/config/flags', '/api/v1/public/sitemap']) expect((await req(`${api}${p}`)).ok, `${p} failed`);
});
await check('Errors use the standard envelope with a request id', async () => {
  const r = await req(`${api}/api/v1/does-not-exist`);
  const b = await r.json().catch(() => ({}));
  expect(r.status === 404 && b.success === false && b.requestId, `got ${r.status}`);
});
await check('Signed-in endpoints refuse anonymous requests', async () => expect((await req(`${api}/api/v1/users/me`)).status === 401, 'GET /users/me without a token was not 401'));
await check('Metrics are not public', async () => {
  const s = (await req(`${api}/metrics`)).status;
  expect(!live || s === 401 || s === 404, `GET /metrics answered ${s} without a token`);
  return `${s}`;
});
if (env === 'production') {
  await check('API reference is off in production', async () => expect((await req(`${api}/api/docs`)).status === 404, '/api/docs is reachable'));
}
await check('Website home page renders', async () => {
  const r = await req(`${web}/`);
  const html = await r.text();
  expect(r.ok && html.includes('PetApp'), `answered ${r.status}`);
  const css = /\/_next\/static\/css\/[^"]+\.css/.exec(html)?.[0];
  expect(css && (await req(`${web}${css}`)).ok, 'its stylesheet did not load');
});
await check(env === 'production' ? 'Search engines may index production' : 'Search engines are kept out', async () => {
  const robots = await (await req(`${web}/robots.txt`)).text();
  if (env === 'production') expect(/Sitemap:/.test(robots) && !/Disallow: \/\s*$/m.test(robots), 'robots.txt blocks everything: set SITE_INDEXABLE=true');
  else expect(/Disallow: \/\s*$/m.test(robots), 'robots.txt allows indexing outside production');
});
await check('App-link files are served as JSON', async () => {
  const a = await req(`${web}/.well-known/assetlinks.json`);
  const i = await req(`${web}/.well-known/apple-app-site-association`);
  expect(a.ok && i.ok && (i.headers.get('content-type') ?? '').includes('application/json'), 'missing or not JSON');
  const android = await a.json();
  const ios = await i.json();
  if (env === 'production') expect(android.length && ios.applinks?.details?.length, 'empty: set ANDROID_PACKAGE_NAME, ANDROID_SHA256_FINGERPRINTS and IOS_APP_ID');
  return android.length ? 'configured' : 'not configured yet';
});
await check('Admin dashboard sign-in page loads', async () => expect((await req(`${admin}/login`)).ok, 'GET /login failed'));
if (live) {
  await check('HTTPS with HSTS everywhere', async () => {
    for (const u of [api, web, admin]) {
      expect(u.startsWith('https://'), `${u} is not https`);
      const h = (await req(`${u}/`)).headers.get('strict-transport-security');
      expect(h, `${u} sends no Strict-Transport-Security header`);
    }
  });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? `${failed} of ${results.length} checks failed` : `All ${results.length} checks passed`} (${env}).`);
process.exit(failed ? 1 : 0);
