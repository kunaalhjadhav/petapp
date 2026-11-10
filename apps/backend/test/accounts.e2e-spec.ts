import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { StorageService } from '../src/providers/storage/storage.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { EMAIL_PROVIDER, type EmailMessage } from '../src/providers/email/email.provider';
import { PUSH_PROVIDER } from '../src/providers/push/push.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { WorkerModule } from '../src/worker/worker.module';
import { MaintenanceProcessor } from '../src/worker/maintenance.processor';
import { base32Decode, hotp, timeStep } from '../src/modules/auth/totp.rules';

const API = '/api/v1';
const MB = 1024 * 1024;
const REEL = readFileSync(join(__dirname, 'fixtures', 'reel-3s.mp4'));
jest.setTimeout(240_000);

/** Phase 9e: staff password change and reset by email; resumable (multipart) uploads. */
describe('Staff passwords and resumable uploads (e2e)', () => {
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  const mail: EmailMessage[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unthrottle = async () => {
    const k = await redis.client.keys('throttle:*');
    if (k.length) await redis.client.del(...k);
  };
  const flag = (key: string, enabled: boolean) => prisma.featureFlag.upsert({ where: { key }, update: { enabled }, create: { key, enabled } }).then(() => redis.client.del('platform:flags'));
  const setting = async (key: string, value: unknown) => {
    await prisma.appSetting.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });
    await redis.client.del('platform:settings');
  };
  const mailTo = (to: string) => mail.filter((m) => m.to === to);
  const linkIn = (m: EmailMessage) => m.text.match(/reset-password\?token=([A-Za-z0-9_-]+)/)![1];
  /** Reset emails are sent in the background: wait for the next one to this address. */
  async function nextMail(to: string, before: number) {
    for (let i = 0; i < 50; i++) {
      if (mailTo(to).length > before) return mailTo(to).at(-1)!;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no email to ${to}`);
  }
  const staffLogin = async (email: string, password: string, expect = 200) => {
    await unthrottle();
    return http().post(`${API}/admin/auth/login`).send({ email, password }).expect(expect);
  };
  async function staff(email: string, role: string, name: string, password = 'Staff-Password-1') {
    const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    const u = await prisma.user.create({ data: { email, name, passwordHash: await bcrypt.hash(password, 10), roles: { create: [{ roleId: r.id }] } } });
    const res = await staffLogin(email, password);
    return { id: u.id, token: res.body.data.tokens.accessToken as string };
  }
  async function customer(phone: string, name: string) {
    await unthrottle();
    await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
    const r = await http().post(`${API}/auth/otp/verify`).send({ phone, code: inbox.get(phone) }).expect(200);
    const token = r.body.data.tokens.accessToken as string;
    await http().patch(`${API}/users/me`).set(bearer(token)).send({ name }).expect(200);
    return { token, id: r.body.data.user.id as string };
  }

  let admin: { id: string; token: string };
  let asha: { id: string; token: string };
  let mod: { id: string; token: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({ name: 'capture', send: async (m: SmsMessage) => (inbox.set(m.to, m.body.match(/\d{6}/)![0]), {}) })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({ name: 'capture', canSend: true, send: async (m: EmailMessage) => (mail.push(m), {}) })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND tablename <> 'spatial_ref_sys'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    admin = await staff('root@acct.test', 'SUPER_ADMIN', 'Root Admin');
    asha = await staff('asha.rao@acct.test', 'SUPPORT_AGENT', 'Asha Rao');
    mod = await staff('mod@acct.test', 'MODERATOR', 'Mo Derator');
    await flag('ENABLE_REELS', true);
    await flag('ENABLE_SERVICES', true);
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(PUSH_PROVIDER).useValue({ name: 'none', send: async () => 'sent' }).compile();
    await worker.init();
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  beforeEach(unthrottle);

  describe('changing your own password', () => {
    it('shows that the given password hasn’t been changed yet', async () => {
      const me = (await http().get(`${API}/admin/auth/me`).set(bearer(asha.token)).expect(200)).body.data;
      expect(me).toMatchObject({ email: 'asha.rao@acct.test', passwordChangedAt: null, emailEnabled: true });
    });

    it('needs the current password and a strong new one, then ends the other sessions', async () => {
      const other = (await staffLogin('asha.rao@acct.test', 'Staff-Password-1')).body.data.tokens.accessToken as string;
      const change = (body: Record<string, string>) => http().post(`${API}/admin/auth/password`).set(bearer(asha.token)).send(body);
      expect((await change({ currentPassword: 'wrong-password-1', newPassword: 'quiet river lantern 42' }).expect(400)).body.message).toBe('Your current password isn’t right.');
      expect((await change({ currentPassword: 'Staff-Password-1', newPassword: 'short' }).expect(400)).body.message).toMatch(/at least 12/);
      expect((await change({ currentPassword: 'Staff-Password-1', newPassword: 'asha-rao-support' }).expect(400)).body.message).toMatch(/name|email/);
      expect((await change({ currentPassword: 'Staff-Password-1', newPassword: 'Password2026!!' }).expect(400)).body.message).toMatch(/too common/);
      const before = mailTo('asha.rao@acct.test').length;
      expect((await change({ currentPassword: 'Staff-Password-1', newPassword: 'quiet river lantern 42' }).expect(200)).body.message).toBe('Password changed. You’ve been signed out everywhere else.');

      await http().get(`${API}/admin/auth/me`).set(bearer(other)).expect(401);
      const me = (await http().get(`${API}/admin/auth/me`).set(bearer(asha.token)).expect(200)).body.data;
      expect(me.passwordChangedAt).not.toBeNull();
      await staffLogin('asha.rao@acct.test', 'Staff-Password-1', 401);
      await staffLogin('asha.rao@acct.test', 'quiet river lantern 42');
      const notice = await nextMail('asha.rao@acct.test', before);
      expect(notice.subject).toBe('Your PetApp Admin password was changed');
      expect(notice.text).toMatch(/was changed on .+ IST\. You’ve been signed out everywhere else\./);
      expect(await prisma.auditLog.count({ where: { action: 'admin.password_change', entityId: asha.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'admin.password_change_failed', entityId: asha.id } })).toBe(1);
      // The same password again is refused.
      expect((await http().post(`${API}/admin/auth/password`).set(bearer(asha.token)).send({ currentPassword: 'quiet river lantern 42', newPassword: 'quiet river lantern 42' }).expect(400)).body.message).toMatch(/haven’t used/);
    });
  });

  describe('forgot password', () => {
    it('answers the same for any address, and only emails staff', async () => {
      const shopper = await customer('+919800000501', 'Shopper One');
      await prisma.user.update({ where: { id: shopper.id }, data: { email: 'shopper@acct.test', passwordHash: await bcrypt.hash('Some-Password-9', 10) } });
      const sent = mail.length;
      const generic = 'If that email belongs to a staff account, we’ve sent it a link to set a new password. The link works for 30 minutes.';
      for (const email of ['nobody@acct.test', 'shopper@acct.test']) {
        expect((await http().post(`${API}/admin/auth/password/forgot`).send({ email }).expect(200)).body.message).toBe(generic);
      }
      await new Promise((r) => setTimeout(r, 500));
      expect(mail.length).toBe(sent);
      expect((await http().post(`${API}/admin/auth/password/forgot`).send({ email: 'Mod@Acct.test' }).expect(200)).body.message).toBe(generic);
      const m = await nextMail('mod@acct.test', 0);
      expect(m.subject).toBe('Reset your PetApp Admin password');
      expect(m.text).toContain('http://localhost:3000/reset-password?token=');
      expect(m.text).toContain('works once, for 30 minutes');
      const stored = await prisma.passwordReset.findFirstOrThrow({ where: { userId: mod.id } });
      expect(stored.tokenHash).not.toBe(linkIn(m));
      expect(stored.requestedBy).toBe('SELF');
    });

    it('resets with a working link once, ends every session, and refuses an old or used link', async () => {
      const first = mailTo('mod@acct.test').at(-1)!;
      const before = mailTo('mod@acct.test').length;
      await http().post(`${API}/admin/auth/password/forgot`).send({ email: 'mod@acct.test' }).expect(200);
      const second = await nextMail('mod@acct.test', before);
      // A new link replaces the earlier one.
      expect((await http().get(`${API}/admin/auth/password/reset?token=${linkIn(first)}`).expect(200)).body.data).toEqual({ valid: false, email: null });
      expect((await http().get(`${API}/admin/auth/password/reset?token=${linkIn(second)}`).expect(200)).body.data).toEqual({ valid: true, email: 'm•••@acct.test' });
      expect((await http().get(`${API}/admin/auth/password/reset?token=nonsense`).expect(200)).body.data.valid).toBe(false);

      // A weak password doesn't use up the link.
      await http().post(`${API}/admin/auth/password/reset`).send({ token: linkIn(second), newPassword: 'tooshort' }).expect(400);
      const r = await http().post(`${API}/admin/auth/password/reset`).send({ token: linkIn(second), newPassword: 'amber kite meadow 7' }).expect(200);
      expect(r.body).toMatchObject({ message: 'Password set. Sign in with it now.', data: { reset: true, email: 'mod@acct.test' } });
      await http().get(`${API}/admin/auth/me`).set(bearer(mod.token)).expect(401);
      expect((await http().post(`${API}/admin/auth/password/reset`).send({ token: linkIn(second), newPassword: 'amber kite meadow 8' }).expect(400)).body.message).toMatch(/expired or was already used/);
      mod.token = (await staffLogin('mod@acct.test', 'amber kite meadow 7')).body.data.tokens.accessToken;
      expect((await nextMail('mod@acct.test', before + 1)).text).toMatch(/was reset on/);
      expect(await prisma.auditLog.count({ where: { action: { in: ['admin.password_reset_requested', 'admin.password_reset'] }, entityId: mod.id } })).toBe(3);
    });

    it('expires links, and limits how many are sent', async () => {
      const before = mailTo('mod@acct.test').length;
      await http().post(`${API}/admin/auth/password/forgot`).send({ email: 'mod@acct.test' }).expect(200);
      const m = await nextMail('mod@acct.test', before);
      await prisma.passwordReset.updateMany({ where: { userId: mod.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await http().get(`${API}/admin/auth/password/reset?token=${linkIn(m)}`).expect(200)).body.data.valid).toBe(false);
      await http().post(`${API}/admin/auth/password/reset`).send({ token: linkIn(m), newPassword: 'amber kite meadow 9' }).expect(400);
      // Three links an hour per address (three were already sent to this one): more requests get the same answer, and no email.
      await unthrottle();
      await http().post(`${API}/admin/auth/password/forgot`).send({ email: 'mod@acct.test' }).expect(200);
      await new Promise((r) => setTimeout(r, 500));
      expect(mailTo('mod@acct.test').length).toBe(before + 1);
    });

    it('lets an administrator send a staff member a link', async () => {
      await http().post(`${API}/admin/auth/staff/${asha.id}/password-reset`).set(bearer(mod.token)).expect(403);
      const shopper = await prisma.user.findFirstOrThrow({ where: { email: 'shopper@acct.test' } });
      await http().post(`${API}/admin/auth/staff/${shopper.id}/password-reset`).set(bearer(admin.token)).expect(404);
      const before = mailTo('asha.rao@acct.test').length;
      expect((await http().post(`${API}/admin/auth/staff/${asha.id}/password-reset`).set(bearer(admin.token)).expect(200)).body.message).toBe('A link to set a new password was sent to asha.rao@acct.test.');
      const m = mailTo('asha.rao@acct.test').at(-1)!;
      expect(mailTo('asha.rao@acct.test').length).toBe(before + 1);
      expect(m.text).toMatch(/A PetApp administrator sent you a link/);
      expect((await prisma.passwordReset.findFirstOrThrow({ where: { userId: asha.id, usedAt: null } })).requestedBy).toBe('STAFF');
      expect(await prisma.auditLog.count({ where: { action: 'admin.password_reset_sent', actorId: admin.id, entityId: asha.id } })).toBe(1);
    });
  });

  describe('resumable uploads', () => {
    let user: { token: string; id: string };
    beforeAll(async () => {
      user = await customer('+919800000502', 'Uploader');
      await setting('media.maxDocumentMb', 20);
    });

    const put = (url: string, headers: Record<string, string>, body: Buffer) => fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });

    it('keeps small files to a single upload', async () => {
      const r = (await http().post(`${API}/media/uploads`).set(bearer(user.token)).send({ kind: 'DOCUMENT', mimeType: 'application/pdf', sizeBytes: 2 * MB, resumable: true }).expect(201)).body.data;
      expect(r.upload.method).toBe('PUT');
      expect((await http().get(`${API}/media/${r.media.id}/upload`).set(bearer(user.token)).expect(200)).body.data).toMatchObject({ method: 'PUT', status: 'PENDING_UPLOAD' });
      await http().post(`${API}/media/${r.media.id}/parts`).set(bearer(user.token)).send({ partNumbers: [1] }).expect(400);
    });

    it('sends a large file in parts, resumes after an interruption, and joins it', async () => {
      const size = 17 * MB + 123;
      const file = Buffer.alloc(size, 7);
      file.write('%PDF-1.7\n', 0, 'latin1');
      const r = (await http().post(`${API}/media/uploads`).set(bearer(user.token)).send({ kind: 'DOCUMENT', mimeType: 'application/pdf', sizeBytes: size, resumable: true }).expect(201)).body.data;
      expect(r.upload).toEqual({ method: 'MULTIPART', partSize: 8 * MB, partCount: 3, expiresInSeconds: 86400 });
      const id = r.media.id as string;

      // Parts are signed one batch at a time, each with its exact length.
      const urls = (await http().post(`${API}/media/${id}/parts`).set(bearer(user.token)).send({ partNumbers: [3, 1, 2, 3] }).expect(200)).body.data.parts;
      expect(urls.map((p: { partNumber: number; length: number }) => [p.partNumber, p.length])).toEqual([[1, 8 * MB], [2, 8 * MB], [3, MB + 123]]);
      expect(urls[0].url).not.toContain('x-amz-checksum');
      await http().post(`${API}/media/${id}/parts`).set(bearer(user.token)).send({ partNumbers: [4] }).expect(400);
      await http().post(`${API}/media/${id}/parts`).set(bearer(user.token)).send({ partNumbers: [] }).expect(400);
      const other = await customer('+919800000503', 'Someone Else');
      await http().post(`${API}/media/${id}/parts`).set(bearer(other.token)).send({ partNumbers: [1] }).expect(404);
      await http().get(`${API}/media/${id}/upload`).set(bearer(other.token)).expect(404);

      // Parts 1 and 3 arrive, then the connection drops: the app asks what arrived, and sends only the rest.
      const [p1, , p3] = urls;
      expect((await put(p1.url, p1.headers, file.subarray(0, 8 * MB))).status).toBe(200);
      expect((await put(p3.url, p3.headers, file.subarray(16 * MB))).status).toBe(200);
      let status = (await http().get(`${API}/media/${id}/upload`).set(bearer(user.token)).expect(200)).body.data;
      expect(status).toMatchObject({ method: 'MULTIPART', partCount: 3, uploaded: [1, 3], missing: [2], uploadedBytes: 9 * MB + 123, sizeBytes: size });
      const early = await http().post(`${API}/media/${id}/complete`).set(bearer(user.token)).expect(400);
      expect(early.body.message).toMatch(/Some parts haven’t arrived yet \(2\)/);

      const again = (await http().post(`${API}/media/${id}/parts`).set(bearer(user.token)).send({ partNumbers: status.missing }).expect(200)).body.data.parts;
      expect((await put(again[0].url, again[0].headers, file.subarray(8 * MB, 16 * MB))).status).toBe(200);
      status = (await http().get(`${API}/media/${id}/upload`).set(bearer(user.token)).expect(200)).body.data;
      expect(status).toMatchObject({ uploaded: [1, 2, 3], missing: [], uploadedBytes: size });

      const done = await http().post(`${API}/media/${id}/complete`).set(bearer(user.token)).expect(200);
      expect(done.body.data).toMatchObject({ id, kind: 'DOCUMENT', status: 'READY' });
      const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
      expect(stored.multipartUploadId).toBeNull();
      expect((await app.get(StorageService).head(stored.storageKey))?.size).toBe(size);
      // Finishing twice is harmless.
      await http().post(`${API}/media/${id}/complete`).set(bearer(user.token)).expect(200);
      expect((await http().get(`${API}/media/${id}/upload`).set(bearer(user.token)).expect(200)).body.data).toMatchObject({ method: 'PUT', status: 'READY' });
    });

    it('processes a video sent in parts like any other', async () => {
      await setting('media.resumableAboveMb', 0);
      const r = (await http().post(`${API}/media/uploads`).set(bearer(user.token)).send({ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: REEL.length, resumable: true }).expect(201)).body.data;
      expect(r.upload).toMatchObject({ method: 'MULTIPART', partCount: 1 });
      const [part] = (await http().post(`${API}/media/${r.media.id}/parts`).set(bearer(user.token)).send({ partNumbers: [1] }).expect(200)).body.data.parts;
      expect((await put(part.url, part.headers, REEL)).status).toBe(200);
      await http().post(`${API}/media/${r.media.id}/complete`).set(bearer(user.token)).expect(200);
      let status = '';
      for (let i = 0; i < 160 && !['READY', 'FAILED', 'REJECTED'].includes(status); i++) {
        status = (await http().get(`${API}/media/${r.media.id}`).set(bearer(user.token)).expect(200)).body.data.status;
        await new Promise((res) => setTimeout(res, 250));
      }
      expect(status).toBe('READY');
      await setting('media.resumableAboveMb', 16);
    });

    it('clears away a resumable upload that was never finished', async () => {
      const size = 20 * MB;
      const r = (await http().post(`${API}/media/uploads`).set(bearer(user.token)).send({ kind: 'DOCUMENT', mimeType: 'application/pdf', sizeBytes: size, resumable: true }).expect(201)).body.data;
      const [p1] = (await http().post(`${API}/media/${r.media.id}/parts`).set(bearer(user.token)).send({ partNumbers: [1] }).expect(200)).body.data.parts;
      await put(p1.url, p1.headers, Buffer.alloc(p1.length, 1));
      const m = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: r.media.id } });
      const storage = app.get(StorageService);
      expect(await storage.listParts(m.storageKey, m.multipartUploadId!)).toHaveLength(1);
      await prisma.mediaAsset.update({ where: { id: m.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
      expect(await worker.get(MaintenanceProcessor).cleanupStaleUploads()).toBeGreaterThanOrEqual(1);
      expect(await prisma.mediaAsset.findUnique({ where: { id: m.id } })).toBeNull();
      expect(await storage.listParts(m.storageKey, m.multipartUploadId!)).toBeNull();
    });
  });

  describe('two-factor sign-in (Phase 10a)', () => {
    let secret = '';
    let recovery: string[] = [];
    /**
     * The code an authenticator app shows now. A code works once, so a test that needs several within 30 seconds
     * first moves the last accepted step back (as if time had passed).
     */
    const nextCode = async () => {
      await prisma.user.update({ where: { id: mod.id }, data: { mfaLastStep: timeStep() - 2 } }).catch(() => undefined);
      return hotp(base32Decode(secret), timeStep());
    };
    const password = 'amber kite meadow 7';
    const afterOff: Array<() => Promise<unknown>> = [];
    afterEach(async () => {
      for (const f of afterOff.splice(0)) await f();
    });

    it('is set up with the password and a code from the app, and gives recovery codes once', async () => {
      const me0 = (await http().get(`${API}/admin/auth/me`).set(bearer(mod.token)).expect(200)).body.data;
      expect(me0).toMatchObject({ mfaEnabled: false, mfaRequired: false, mfaSetupRequired: false, recoveryCodesLeft: 0 });
      await http().post(`${API}/admin/auth/mfa/setup`).set(bearer(mod.token)).send({ password: 'wrong password!!' }).expect(400);
      const setup = (await http().post(`${API}/admin/auth/mfa/setup`).set(bearer(mod.token)).send({ password }).expect(200)).body.data;
      expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setup.otpauthUrl).toBe(`otpauth://totp/PetApp%20Admin%3Amod%40acct.test?secret=${setup.secret}&issuer=PetApp%20Admin&algorithm=SHA1&digits=6&period=30`);
      secret = setup.secret;
      await http().post(`${API}/admin/auth/mfa/enable`).set(bearer(mod.token)).send({ code: '000000' }).expect(400);
      const other = (await staffLogin('mod@acct.test', password)).body.data.tokens.accessToken as string;
      const before = mailTo('mod@acct.test').length;
      const r = (await http().post(`${API}/admin/auth/mfa/enable`).set(bearer(mod.token)).send({ code: await nextCode() }).expect(200)).body.data;
      recovery = r.recoveryCodes;
      expect(recovery).toHaveLength(10);
      await http().get(`${API}/admin/auth/me`).set(bearer(other)).expect(401);
      expect((await http().get(`${API}/admin/auth/me`).set(bearer(mod.token)).expect(200)).body.data).toMatchObject({ mfaEnabled: true, recoveryCodesLeft: 10 });
      const u = await prisma.user.findUniqueOrThrow({ where: { id: mod.id } });
      expect(u.mfaSecret).toMatch(/^v1:/);
      expect(u.mfaSecret).not.toContain(secret);
      expect(await prisma.mfaRecoveryCode.findFirst({ where: { codeHash: recovery[0] } })).toBeNull();
      expect((await nextMail('mod@acct.test', before)).subject).toBe('Two-factor sign-in is on');
      await http().post(`${API}/admin/auth/mfa/setup`).set(bearer(mod.token)).send({ password }).expect(409);
    });

    it('asks for a code after the password, once, with few tries', async () => {
      const first = (await staffLogin('mod@acct.test', password)).body.data;
      expect(first).toEqual({ mfaRequired: true, mfaTicket: expect.any(String), expiresInSeconds: 300 });
      expect(first.tokens).toBeUndefined();
      const bad = await http().post(`${API}/admin/auth/login/mfa`).send({ mfaTicket: first.mfaTicket, code: '123456' }).expect(401);
      expect(bad.body.message).toMatch(/isn’t right/);
      const code = await nextCode();
      const ok = (await http().post(`${API}/admin/auth/login/mfa`).send({ mfaTicket: first.mfaTicket, code }).expect(200)).body.data;
      expect(ok.tokens.accessToken).toBeTruthy();
      mod.token = ok.tokens.accessToken;
      // The ticket is used up, and the same code can't sign in again.
      await http().post(`${API}/admin/auth/login/mfa`).send({ mfaTicket: first.mfaTicket, code: '000000' }).expect(401);
      const again = (await staffLogin('mod@acct.test', password)).body.data;
      expect((await http().post(`${API}/admin/auth/login/mfa`).send({ mfaTicket: again.mfaTicket, code }).expect(401)).body.message).toMatch(/isn’t right/);
      // Five wrong codes end the ticket.
      for (let i = 0; i < 4; i++) await http().post(`${API}/admin/auth/login/mfa`).send({ mfaTicket: again.mfaTicket, code: '111111' }).expect(401);
      expect((await http().post(`${API}/admin/auth/login/mfa`).send({ mfaTicket: again.mfaTicket, code: await nextCode() }).expect(401)).body.message).toMatch(/expired/);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.login', entityId: mod.id }, orderBy: { createdAt: 'desc' } });
      expect(audit.after).toEqual({ method: 'password+totp' });
    });

    it('accepts a recovery code once, and tells the owner', async () => {
      const t = (await staffLogin('mod@acct.test', password)).body.data.mfaTicket;
      const before = mailTo('mod@acct.test').length;
      await http().post(`${API}/admin/auth/login/mfa`).send({ mfaTicket: t, code: recovery[0].toUpperCase() }).expect(200);
      expect((await nextMail('mod@acct.test', before)).text).toMatch(/You have 9 left/);
      const t2 = (await staffLogin('mod@acct.test', password)).body.data.mfaTicket;
      await http().post(`${API}/admin/auth/login/mfa`).send({ mfaTicket: t2, code: recovery[0] }).expect(401);
      const fresh = (await http().post(`${API}/admin/auth/mfa/recovery-codes`).set(bearer(mod.token)).send({ code: await nextCode() }).expect(200)).body.data.recoveryCodes;
      expect(fresh).toHaveLength(10);
      await http().post(`${API}/admin/auth/login/mfa`).send({ mfaTicket: t2, code: recovery[1] }).expect(401); // old codes stop working
      recovery = fresh;
    });

    it('can be required for all staff: until then, only setup is open', async () => {
      await setting('security.requireStaffMfa', true);
      afterOff.push(() => setting('security.requireStaffMfa', false));
      const r = await http().get(`${API}/admin/users`).set(bearer(asha.token)).expect(403);
      expect(r.body.errors[0].code).toBe('MFA_SETUP_REQUIRED');
      expect((await http().get(`${API}/admin/auth/me`).set(bearer(asha.token)).expect(200)).body.data).toMatchObject({ mfaSetupRequired: true });
      await http().post(`${API}/admin/auth/mfa/setup`).set(bearer(asha.token)).send({ password: 'quiet river lantern 42' }).expect(200);
      await http().get(`${API}/admin/users`).set(bearer(mod.token)).expect(200); // with two-factor on, nothing changes
      // Required: it can't be switched off by its owner.
      expect((await http().post(`${API}/admin/auth/mfa/disable`).set(bearer(mod.token)).send({ password, code: await nextCode() }).expect(403)).body.message).toMatch(/required for staff/);
      await setting('security.requireStaffMfa', false);
    });

    it('lets an administrator reset it for a lost phone, and its owner turn it off', async () => {
      await http().post(`${API}/admin/auth/staff/${mod.id}/mfa-reset`).set(bearer(asha.token)).expect(403);
      expect((await http().post(`${API}/admin/auth/staff/${mod.id}/mfa-reset`).set(bearer(admin.token)).expect(200)).body.message).toMatch(/was reset/);
      await http().get(`${API}/admin/auth/me`).set(bearer(mod.token)).expect(401);
      const login = (await staffLogin('mod@acct.test', password)).body.data;
      expect(login.tokens.accessToken).toBeTruthy();
      expect(await prisma.mfaRecoveryCode.count({ where: { userId: mod.id } })).toBe(0);
      await http().post(`${API}/admin/auth/staff/${admin.id}/mfa-reset`).set(bearer(admin.token)).expect(400);

      // Turn it on again, then off with the password and a code.
      mod.token = login.tokens.accessToken;
      secret = (await http().post(`${API}/admin/auth/mfa/setup`).set(bearer(mod.token)).send({ password }).expect(200)).body.data.secret;
      await http().post(`${API}/admin/auth/mfa/enable`).set(bearer(mod.token)).send({ code: await nextCode() }).expect(200);
      await http().post(`${API}/admin/auth/mfa/disable`).set(bearer(mod.token)).send({ password, code: '000000' }).expect(400);
      await http().post(`${API}/admin/auth/mfa/disable`).set(bearer(mod.token)).send({ password, code: await nextCode() }).expect(200);
      expect((await staffLogin('mod@acct.test', password)).body.data.tokens).toBeTruthy();
      const actions = (await prisma.auditLog.findMany({ where: { entityId: mod.id, action: { startsWith: 'admin.mfa' } } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['admin.mfa_enabled', 'admin.mfa_failed', 'admin.mfa_recovery_codes', 'admin.mfa_reset', 'admin.mfa_disabled']));
    });
  });
});
