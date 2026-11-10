import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';

const API = '/api/v1';
const ADMIN_EMAIL = 'root@test.local';
const ADMIN_PASSWORD = 'Root-Password-123';

describe('PetApp API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  let dogId: string;
  let catId: string;
  let labradorId: string;
  let persianId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function loginPhone(phone: string) {
    await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
    const code = inbox.get(phone)!;
    const res = await http().post(`${API}/auth/otp/verify`).send({ phone, code }).expect(200);
    return res.body.data as { user: { id: string; roles: string[] }; tokens: { accessToken: string; refreshToken: string }; isNewUser: boolean };
  }

  async function createStaff(email: string, roleKey: string) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const user = await prisma.user.create({
      data: { email, name: roleKey, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10), roles: { create: [{ roleId: role.id }] } },
    });
    return user.id;
  }

  async function adminLogin(email: string) {
    const res = await http().post(`${API}/admin/auth/login`).send({ email, password: ADMIN_PASSWORD }).expect(200);
    return res.body.data.tokens.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({
        name: 'capture',
        send: async (m: SmsMessage) => {
          inbox.set(m.to, m.body.match(/\d{6}/)![0]);
          return {};
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);

    await syncRbac(prisma);
    const dog = await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog', breeds: { create: [{ name: 'Labrador Retriever' }] } }, include: { breeds: true } });
    const cat = await prisma.petSpecies.create({ data: { key: 'cat', name: 'Cat', breeds: { create: [{ name: 'Persian' }] } }, include: { breeds: true } });
    [dogId, catId, labradorId, persianId] = [dog.id, cat.id, dog.breeds[0].id, cat.breeds[0].id];
    await createStaff(ADMIN_EMAIL, 'SUPER_ADMIN');
  });

  beforeEach(async () => {
    const keys = await redis.client.keys('throttle:*');
    if (keys.length) await redis.client.del(...keys);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('platform', () => {
    it('reports health and readiness outside the API prefix', async () => {
      await http().get('/health').expect(200);
      const res = await http().get('/ready').expect(200);
      expect(res.body.data.checks.database.ok).toBe(true);
      expect(res.body.data.checks.redis.ok).toBe(true);
    });

    it('returns the standard error envelope and rejects unknown fields', async () => {
      const res = await http().post(`${API}/auth/otp/request`).send({ phone: '9812345678', admin: true }).expect(400);
      expect(res.body).toMatchObject({ success: false, message: 'Validation failed' });
      expect(res.body.errors[0].message).toMatch(/admin should not exist/);
      expect(res.body.requestId).toBeDefined();
    });

    it('requires authentication by default', async () => {
      const res = await http().get(`${API}/users/me`).expect(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('phone OTP auth', () => {
    it('rejects invalid numbers', async () => {
      await http().post(`${API}/auth/otp/request`).send({ phone: '12345' }).expect(400);
    });

    it('signs up a new customer and does not accept a code twice', async () => {
      const phone = '+919811100001';
      await http().post(`${API}/auth/otp/request`).send({ phone: '98111 00001' }).expect(200);
      const code = inbox.get(phone)!;
      const wrong = code === '000000' ? '111111' : '000000';
      const bad = await http().post(`${API}/auth/otp/verify`).send({ phone, code: wrong }).expect(400);
      expect(bad.body.message).toMatch(/attempts? left/);

      const ok = await http().post(`${API}/auth/otp/verify`).send({ phone, code }).expect(200);
      expect(ok.body.data.isNewUser).toBe(true);
      expect(ok.body.data.user.roles).toEqual(['CUSTOMER']);
      await http().post(`${API}/auth/otp/verify`).send({ phone, code }).expect(400);

      const me = await http().get(`${API}/users/me`).set(bearer(ok.body.data.tokens.accessToken)).expect(200);
      expect(me.body.data.phone).toBe(phone);
    });

    it('rate-limits OTP requests per IP', async () => {
      for (let i = 0; i < 5; i++) await http().post(`${API}/auth/otp/request`).send({ phone: `+91981110010${i}` }).expect(200);
      const res = await http().post(`${API}/auth/otp/request`).send({ phone: '+919811100109' }).expect(429);
      expect(res.body.success).toBe(false);
    });
  });

  describe('email auth', () => {
    it('registers, rejects duplicates and wrong passwords, then signs in', async () => {
      const body = { email: 'Maya@Example.com', password: 'Str0ng-pass', name: 'Maya' };
      const reg = await http().post(`${API}/auth/email/register`).send(body).expect(201);
      expect(reg.body.data.user.email).toBe('maya@example.com');
      await http().post(`${API}/auth/email/register`).send(body).expect(409);
      await http().post(`${API}/auth/email/login`).send({ email: body.email, password: 'wrong-pass1' }).expect(401);
      await http().post(`${API}/auth/email/login`).send({ email: body.email, password: body.password }).expect(200);
    });

    it('enforces password strength', async () => {
      await http().post(`${API}/auth/email/register`).send({ email: 'weak@example.com', password: 'password', name: 'W' }).expect(400);
    });
  });

  describe('sessions', () => {
    it('rotates refresh tokens and revokes the family when an old token is reused', async () => {
      const { tokens } = await loginPhone('+919811100002');
      const r1 = await http().post(`${API}/auth/refresh`).send({ refreshToken: tokens.refreshToken }).expect(200);
      const next = r1.body.data.refreshToken as string;
      expect(next).not.toBe(tokens.refreshToken);

      await http().post(`${API}/auth/refresh`).send({ refreshToken: tokens.refreshToken }).expect(401);
      await http().post(`${API}/auth/refresh`).send({ refreshToken: next }).expect(401);
    });

    it('logout revokes the session’s refresh token', async () => {
      const { tokens } = await loginPhone('+919811100003');
      await http().post(`${API}/auth/logout`).set(bearer(tokens.accessToken)).expect(200);
      await http().post(`${API}/auth/refresh`).send({ refreshToken: tokens.refreshToken }).expect(401);
    });
  });

  describe('pets', () => {
    let owner: string;
    let other: string;
    let petId: string;
    let handle: string;

    beforeAll(async () => {
      owner = (await loginPhone('+919811100010')).tokens.accessToken;
      other = (await loginPhone('+919811100011')).tokens.accessToken;
    });

    it('validates that the breed belongs to the species', async () => {
      await http().post(`${API}/pets`).set(bearer(owner)).send({ name: 'Bruno', speciesId: dogId, breedId: persianId }).expect(400);
    });

    it('creates a pet and hides owner-only fields from others', async () => {
      const res = await http()
        .post(`${API}/pets`)
        .set(bearer(owner))
        .send({ name: 'Bruno', speciesId: dogId, breedId: labradorId, gender: 'MALE', dateOfBirth: '2023-08-14', weightKg: 31.5, microchipId: '985100001234567', medicalNotes: 'Allergic to chicken', personality: ['Playful'] })
        .expect(201);
      petId = res.body.data.id;
      handle = res.body.data.handle;
      expect(handle).toMatch(/^bruno\.[0-9a-f]{6}$/);
      expect(res.body.data.microchipId).toBe('985100001234567');
      expect(res.body.data.personality).toEqual(['playful']);

      const anon = await http().get(`${API}/pets/${handle}`).expect(200);
      expect(anon.body.data.name).toBe('Bruno');
      expect(anon.body.data).not.toHaveProperty('microchipId');
      expect(anon.body.data).not.toHaveProperty('medicalNotes');
      expect(anon.body.data).not.toHaveProperty('vaccinations');

      const mine = await http().get(`${API}/pets/${petId}`).set(bearer(owner)).expect(200);
      expect(mine.body.data.isOwner).toBe(true);
      expect(mine.body.data.medicalNotes).toBe('Allergic to chicken');
    });

    it('blocks other users from editing or deleting (no IDOR)', async () => {
      await http().patch(`${API}/pets/${petId}`).set(bearer(other)).send({ name: 'Hacked' }).expect(404);
      await http().delete(`${API}/pets/${petId}`).set(bearer(other)).expect(404);
      await http().post(`${API}/pets/${petId}/vaccinations`).set(bearer(other)).send({ name: 'Rabies' }).expect(404);
    });

    it('follows idempotently and keeps the follower count correct', async () => {
      await http().post(`${API}/pets/${petId}/follow`).set(bearer(other)).expect(200);
      await http().post(`${API}/pets/${petId}/follow`).set(bearer(other)).expect(200);
      let view = await http().get(`${API}/pets/${petId}`).set(bearer(other)).expect(200);
      expect(view.body.data.followerCount).toBe(1);
      expect(view.body.data.isFollowing).toBe(true);
      await http().post(`${API}/pets/${petId}/follow`).set(bearer(owner)).expect(400);
      await http().delete(`${API}/pets/${petId}/follow`).set(bearer(other)).expect(200);
      view = await http().get(`${API}/pets/${petId}`).expect(200);
      expect(view.body.data.followerCount).toBe(0);
    });

    it('respects private visibility and appears in discovery only when public', async () => {
      let list = await http().get(`${API}/pets?speciesId=${dogId}`).expect(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).toContain(petId);
      expect(list.body.meta).toMatchObject({ page: 1, total: expect.any(Number) });

      await http().patch(`${API}/pets/${petId}`).set(bearer(owner)).send({ visibility: 'PRIVATE' }).expect(200);
      await http().get(`${API}/pets/${petId}`).set(bearer(other)).expect(404);
      list = await http().get(`${API}/pets?speciesId=${dogId}`).expect(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).not.toContain(petId);
      await http().patch(`${API}/pets/${petId}`).set(bearer(owner)).send({ visibility: 'PUBLIC' }).expect(200);
    });

    it('cannot change species after creation', async () => {
      await http().patch(`${API}/pets/${petId}`).set(bearer(owner)).send({ speciesId: catId }).expect(400);
    });
  });

  describe('addresses', () => {
    it('keeps one default and scopes access to the owner', async () => {
      const a = (await loginPhone('+919811100020')).tokens.accessToken;
      const b = (await loginPhone('+919811100021')).tokens.accessToken;
      const addr = { line1: '12 Hill Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400050' };
      const first = await http().post(`${API}/users/me/addresses`).set(bearer(a)).send(addr).expect(201);
      expect(first.body.data.isDefault).toBe(true);
      const second = await http().post(`${API}/users/me/addresses`).set(bearer(a)).send({ ...addr, line1: '5 Sea View', isDefault: true }).expect(201);
      const list = await http().get(`${API}/users/me/addresses`).set(bearer(a)).expect(200);
      expect(list.body.data.filter((x: { isDefault: boolean }) => x.isDefault)).toHaveLength(1);
      expect(list.body.data[0].id).toBe(second.body.data.id);

      await http().patch(`${API}/users/me/addresses/${first.body.data.id}`).set(bearer(b)).send({ city: 'Pune' }).expect(404);
      await http().post(`${API}/users/me/addresses`).set(bearer(a)).send({ ...addr, pincode: '12345' }).expect(400);
    });
  });

  describe('admin', () => {
    let rootToken: string;

    beforeAll(async () => {
      rootToken = await adminLogin(ADMIN_EMAIL);
    });

    it('keeps app and admin sessions separate', async () => {
      const customer = (await loginPhone('+919811100030')).tokens.accessToken;
      await http().get(`${API}/admin/users`).set(bearer(customer)).expect(403);
      await http().get(`${API}/users/me`).set(bearer(rootToken)).expect(403);
      await http().post(`${API}/admin/auth/login`).send({ email: 'maya@example.com', password: 'Str0ng-pass' }).expect(403);
    });

    it('searches users with pagination', async () => {
      const res = await http().get(`${API}/admin/users?search=98111&limit=5`).set(bearer(rootToken)).expect(200);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
      expect(res.body.meta.total).toBeGreaterThan(0);
    });

    it('suspends a user: access stops at once, sessions are revoked, action is audited', async () => {
      const victim = await loginPhone('+919811100040');
      await http().get(`${API}/users/me`).set(bearer(victim.tokens.accessToken)).expect(200);

      await http()
        .patch(`${API}/admin/users/${victim.user.id}/status`)
        .set(bearer(rootToken))
        .send({ status: 'SUSPENDED', reason: 'Spam reports' })
        .expect(200);

      await http().get(`${API}/users/me`).set(bearer(victim.tokens.accessToken)).expect(403);
      await http().post(`${API}/auth/refresh`).send({ refreshToken: victim.tokens.refreshToken }).expect(401);
      await http().post(`${API}/auth/otp/request`).send({ phone: '+919811100040' }).expect(403);

      const logs = await http().get(`${API}/admin/audit-logs?action=user.status&entityId=${victim.user.id}`).set(bearer(rootToken)).expect(200);
      expect(logs.body.data[0].after).toMatchObject({ status: 'SUSPENDED', reason: 'Spam reports' });

      await http().patch(`${API}/admin/users/${victim.user.id}/status`).set(bearer(rootToken)).send({ status: 'SUSPENDED', reason: 'Twice' }).expect(400);
      await http().patch(`${API}/admin/users/${victim.user.id}/status`).set(bearer(rootToken)).send({ status: 'ACTIVE', reason: 'Appeal accepted' }).expect(200);
      await loginPhone('+919811100040');
    });

    it('enforces permissions for moderators', async () => {
      await createStaff('mod@test.local', 'MODERATOR');
      const mod = await adminLogin('mod@test.local');
      await http().get(`${API}/admin/users`).set(bearer(mod)).expect(200);
      await http().get(`${API}/admin/audit-logs`).set(bearer(mod)).expect(403);
      await http().get(`${API}/admin/roles`).set(bearer(mod)).expect(403);
    });

    it('prevents privilege escalation by a non-super admin', async () => {
      const adminId = await createStaff('admin@test.local', 'ADMIN');
      const admin = await adminLogin('admin@test.local');
      const target = await loginPhone('+919811100050');
      await http().put(`${API}/admin/users/${target.user.id}/roles`).set(bearer(admin)).send({ roleKeys: ['CUSTOMER', 'SUPER_ADMIN'] }).expect(403);
      await http().put(`${API}/admin/users/${adminId}/roles`).set(bearer(admin)).send({ roleKeys: ['ADMIN', 'JUDGE'] }).expect(403);
      const ok = await http().put(`${API}/admin/users/${target.user.id}/roles`).set(bearer(admin)).send({ roleKeys: ['CUSTOMER', 'JUDGE'] }).expect(200);
      expect(ok.body.data.roles).toEqual(['CUSTOMER', 'JUDGE']);
    });

    it('role permission edits take effect immediately', async () => {
      await createStaff('support@test.local', 'SUPPORT_AGENT');
      const support = await adminLogin('support@test.local');
      await http().get(`${API}/admin/audit-logs`).set(bearer(support)).expect(403);
      await http().patch(`${API}/admin/roles/SUPPORT_AGENT`).set(bearer(rootToken)).send({ permissionKeys: ['users.read', 'users.update', 'pets.read_any', 'audit.read'] }).expect(200);
      await http().get(`${API}/admin/audit-logs`).set(bearer(support)).expect(200);
      await http().patch(`${API}/admin/roles/SUPER_ADMIN`).set(bearer(rootToken)).send({ name: 'x' }).expect(400);
    });

    it('manages species and breeds with audit', async () => {
      const s = await http().post(`${API}/admin/species`).set(bearer(rootToken)).send({ key: 'guinea-pig', name: 'Guinea pig' }).expect(201);
      await http().post(`${API}/admin/species/${s.body.data.id}/breeds`).set(bearer(rootToken)).send({ name: 'Abyssinian' }).expect(201);
      const pub = await http().get(`${API}/species/${s.body.data.id}/breeds`).expect(200);
      expect(pub.body.data[0].name).toBe('Abyssinian');
      await http().patch(`${API}/admin/species/${s.body.data.id}`).set(bearer(rootToken)).send({ isActive: false }).expect(200);
      await http().get(`${API}/species/${s.body.data.id}/breeds`).expect(404);
    });

    it('toggles feature flags and exposes them publicly', async () => {
      await http().patch(`${API}/admin/flags/ENABLE_REELS`).set(bearer(rootToken)).send({ enabled: true }).expect(200);
      const flags = await http().get(`${API}/config/flags`).expect(200);
      expect(flags.body.data.ENABLE_REELS).toBe(true);
      expect(flags.body.data.ENABLE_CONTESTS).toBe(false);
      await http().patch(`${API}/admin/flags/NOT_A_FLAG`).set(bearer(rootToken)).send({ enabled: true }).expect(404);
    });

    it('returns an overview scoped to the caller’s permissions', async () => {
      const full = await http().get(`${API}/admin/overview`).set(bearer(rootToken)).expect(200);
      expect(full.body.data.users.total).toBeGreaterThan(0);
      expect(full.body.data.users.signupsByDay).toHaveLength(14);
      expect(full.body.data.pets.bySpecies.length).toBeGreaterThan(0);
      expect(full.body.data.recentAudit.length).toBeGreaterThan(0);
      expect(full.body.data.recentAudit.every((a: { action: string }) => a.action !== 'admin.login')).toBe(true);
      const mod = await adminLogin('mod@test.local');
      const scoped = await http().get(`${API}/admin/overview`).set(bearer(mod)).expect(200);
      expect(scoped.body.data.users).not.toBeNull();
      expect(scoped.body.data.recentAudit).toBeNull();
    });

    it('validates setting types', async () => {
      await http().put(`${API}/admin/settings/pets.maxPerUser`).set(bearer(rootToken)).send({ value: 'lots' }).expect(400);
      await http().put(`${API}/admin/settings/pets.maxPerUser`).set(bearer(rootToken)).send({ value: 1 }).expect(200);
      const user = (await loginPhone('+919811100060')).tokens.accessToken;
      await http().post(`${API}/pets`).set(bearer(user)).send({ name: 'One', speciesId: catId }).expect(201);
      await http().post(`${API}/pets`).set(bearer(user)).send({ name: 'Two', speciesId: catId }).expect(400);
      await http().put(`${API}/admin/settings/pets.maxPerUser`).set(bearer(rootToken)).send({ value: 10 }).expect(200);
    });
  });

  describe('audit log integrity', () => {
    it('cannot be deleted or edited, even directly in the database', async () => {
      await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
      const row = await prisma.auditLog.findFirstOrThrow();
      await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    });
  });
});
