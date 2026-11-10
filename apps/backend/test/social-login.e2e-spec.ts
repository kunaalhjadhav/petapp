import './social-login.env';
import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { SocialAuthService } from '../src/modules/auth/social.service';
import { syncRbac } from '../src/modules/rbac/rbac.seed';

const API = '/api/v1';
const GOOGLE_WEB_CLIENT = 'petapp-web.apps.googleusercontent.com';
const IOS_BUNDLE = 'com.petapp.petapp';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Sign in with Google (Android) and Apple (iOS), then add a mobile number (final release). Apple tokens are signed
 * here with a test key standing in for Apple's; Google's check is replaced by one that knows the test tokens.
 */
describe('Google and Apple sign-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const inbox = new Map<string, string>();
  let appleKey: KeyLike;
  const googleTokens = new Map<string, Record<string, unknown>>();
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const appleToken = (claims: Record<string, unknown>, aud = IOS_BUNDLE) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://appleid.apple.com').setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(appleKey);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({ name: 'capture', send: async (m: SmsMessage) => (inbox.set(m.to, m.body.match(/\d{6}/)![0]), {}) })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await app.get(RedisService).client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);

    const social = app.get(SocialAuthService);
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    appleKey = privateKey;
    social.appleKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' }] });
    social.google = {
      verifyIdToken: async ({ idToken, audience }: { idToken: string; audience: string[] }) => {
        const p = googleTokens.get(idToken);
        if (!p || !audience.includes(String(p.aud))) throw new Error('Invalid token');
        return { getPayload: () => p };
      },
    } as never;
  });
  afterAll(async () => {
    await app.close();
  });

  it('Google: a new account, then the same account again; a token for another app is refused', async () => {
    googleTokens.set('g-tok-1', { sub: 'google-111', aud: GOOGLE_WEB_CLIENT, email: 'Aanya.Kapoor@gmail.com', email_verified: true, name: 'Aanya Kapoor', picture: 'https://lh3/x.jpg' });
    const first = (await http().post(`${API}/auth/google`).send({ idToken: 'g-tok-1' }).expect(200)).body.data;
    expect(first).toMatchObject({ isNewUser: true, user: { name: 'Aanya Kapoor', email: 'aanya.kapoor@gmail.com', phone: null } });
    expect(first.tokens.accessToken).toBeTruthy();
    const again = (await http().post(`${API}/auth/google`).send({ idToken: 'g-tok-1' }).expect(200)).body.data;
    expect(again).toMatchObject({ isNewUser: false, user: { id: first.user.id } });
    const me = (await http().get(`${API}/users/me`).set(bearer(again.tokens.accessToken)).expect(200)).body.data;
    expect(me).toMatchObject({ email: 'aanya.kapoor@gmail.com', phoneVerifiedAt: null });
    googleTokens.set('g-tok-other', { sub: 'google-222', aud: 'someone-elses-app.apps.googleusercontent.com', email: 'x@gmail.com', email_verified: true });
    expect((await http().post(`${API}/auth/google`).send({ idToken: 'g-tok-other' }).expect(401)).body.message).toBe('Google sign-in failed. Please try again.');
  });

  it('Google: a verified email that already has an account signs into that account', async () => {
    const existing = await prisma.user.create({ data: { email: 'kabir@example.in', emailVerifiedAt: new Date(), name: 'Kabir Mehta' } });
    googleTokens.set('g-tok-kabir', { sub: 'google-333', aud: GOOGLE_WEB_CLIENT, email: 'kabir@example.in', email_verified: true });
    const r = (await http().post(`${API}/auth/google`).send({ idToken: 'g-tok-kabir' }).expect(200)).body.data;
    expect(r).toMatchObject({ isNewUser: false, user: { id: existing.id } });
    googleTokens.set('g-tok-unverified', { sub: 'google-444', aud: GOOGLE_WEB_CLIENT, email: 'kabir@example.in', email_verified: false });
    const u = (await http().post(`${API}/auth/google`).send({ idToken: 'g-tok-unverified' }).expect(200)).body.data;
    expect(u.user.id).not.toBe(existing.id); // an unverified email never takes over an account
  });

  it('Apple: the name arrives only the first time; the nonce must match; other apps and replays are refused', async () => {
    const nonce = 'nonce-abcdef-0123456789';
    const tok = await appleToken({ sub: 'apple-001.abc', email: 'xyz@privaterelay.appleid.com', email_verified: 'true', nonce: sha(nonce) });
    const first = (await http().post(`${API}/auth/apple`).send({ identityToken: tok, name: 'Riya Sharma', nonce }).expect(200)).body.data;
    expect(first).toMatchObject({ isNewUser: true, user: { name: 'Riya Sharma', email: 'xyz@privaterelay.appleid.com' } });
    const nonce2 = 'nonce-second-0123456789';
    const tok2 = await appleToken({ sub: 'apple-001.abc', nonce: sha(nonce2) }); // later sign-ins carry no name or email
    const again = (await http().post(`${API}/auth/apple`).send({ identityToken: tok2, nonce: nonce2 }).expect(200)).body.data;
    expect(again).toMatchObject({ isNewUser: false, user: { id: first.user.id, name: 'Riya Sharma' } });
    expect((await http().post(`${API}/auth/apple`).send({ identityToken: tok2, nonce: 'nonce-somebody-else-000' }).expect(401)).body.message).toBe('Apple sign-in failed. Please try again.');
    const partnerTok = await appleToken({ sub: 'apple-002', nonce: sha(nonce) }, 'com.petapp.partner.petappPartner');
    expect((await http().post(`${API}/auth/apple`).send({ identityToken: partnerTok, nonce }).expect(200)).body.data.isNewUser).toBe(true);
    const wrongApp = await appleToken({ sub: 'apple-003', nonce: sha(nonce) }, 'com.other.app');
    await http().post(`${API}/auth/apple`).send({ identityToken: wrongApp, nonce }).expect(401);
    await http().post(`${API}/auth/apple`).send({ identityToken: tok }).expect(400); // the nonce is required
  });

  it('adding a mobile number: a code to the new number; numbers of other accounts are refused', async () => {
    googleTokens.set('g-tok-phone', { sub: 'google-555', aud: GOOGLE_WEB_CLIENT, email: 'pet.parent@gmail.com', email_verified: true });
    const s = (await http().post(`${API}/auth/google`).send({ idToken: 'g-tok-phone' }).expect(200)).body.data;
    const t = s.tokens.accessToken;
    await http().post(`${API}/auth/phone/request`).send({ phone: '9876500011' }).expect(401); // signed in only
    await http().post(`${API}/auth/phone/request`).set(bearer(t)).send({ phone: '9876500011' }).expect(200);
    const code = inbox.get('+919876500011')!;
    await http().post(`${API}/auth/phone/verify`).set(bearer(t)).send({ phone: '9876500011', code: code === '000000' ? '111111' : '000000' }).expect(400);
    const ok = (await http().post(`${API}/auth/phone/verify`).set(bearer(t)).send({ phone: '9876500011', code }).expect(200)).body;
    expect(ok).toMatchObject({ message: 'Mobile number verified.', data: { phone: '+919876500011', phoneVerified: true } });
    const me = (await http().get(`${API}/users/me`).set(bearer(t)).expect(200)).body.data;
    expect(me.phone).toBe('+919876500011');
    expect(me.phoneVerifiedAt).toBeTruthy();
    // That number now signs into the same account with a code, too.
    await http().post(`${API}/auth/otp/request`).send({ phone: '9876500011' }).expect(200);
    const login = (await http().post(`${API}/auth/otp/verify`).send({ phone: '9876500011', code: inbox.get('+919876500011') }).expect(200)).body.data;
    expect(login.user.id).toBe(s.user.id);
    // Someone else can't take the number, and a code meant for adding a number can't sign anyone in.
    const other = (await http().post(`${API}/auth/google`).send({ idToken: 'g-tok-1' }).expect(200)).body.data.tokens.accessToken;
    expect((await http().post(`${API}/auth/phone/request`).set(bearer(other)).send({ phone: '9876500011' }).expect(409)).body.message).toMatch(/already has a PetApp account/);
    await http().post(`${API}/auth/phone/request`).set(bearer(other)).send({ phone: '9876500022' }).expect(200);
    await http().post(`${API}/auth/otp/verify`).send({ phone: '9876500022', code: inbox.get('+919876500022') }).expect(400);
    expect(await prisma.auditLog.count({ where: { action: 'user.phone_verified', entityId: s.user.id } })).toBe(1);
  });
});
