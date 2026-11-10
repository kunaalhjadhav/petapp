import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { syncRbac } from '../src/modules/rbac/rbac.seed';

const API = '/api/v1';
jest.setTimeout(60_000);

/** The public website's sitemap data: only what anyone can already see, and only for features that are on. */
describe('Public web data (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const http = () => request(app.getHttpServer());
  const sitemap = async () => {
    await redis.client.del('public:sitemap', 'platform:flags');
    return (await http().get(`${API}/public/sitemap`).expect(200)).body.data;
  };
  const flag = (key: string, enabled: boolean) => prisma.featureFlag.upsert({ where: { key }, update: { enabled }, create: { key, enabled } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    const species = await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } });
    const owner = await prisma.user.create({ data: { name: 'Owner', phone: '+919811111111' } });
    const gone = await prisma.user.create({ data: { name: 'Gone', phone: '+919822222222', status: 'SUSPENDED' } });
    const pet = (handle: string, extra: Record<string, unknown> = {}, ownerId = owner.id) =>
      prisma.pet.create({ data: { name: handle, handle, speciesId: species.id, ownerId, ...extra } });
    await pet('public.pup');
    await pet('private.pup', { visibility: 'PRIVATE' });
    await pet('friends.pup', { visibility: 'FOLLOWERS' });
    await pet('hidden.pup', { status: 'HIDDEN' });
    await pet('deleted.pup', { deletedAt: new Date() });
    await pet('suspended.owner.pup', {}, gone.id);
    await prisma.servicePartner.create({
      data: { userId: owner.id, slug: 'happy-paws-pune', businessName: 'Happy Paws', phone: '9811111111', addressLine: '1 Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', lat: 18.5, lng: 73.8, status: 'APPROVED' },
    });
    await prisma.legalDocument.createMany({
      data: [
        { slug: 'privacy-policy', version: 1, title: 'Privacy Policy', body: '# Privacy Policy\n\nText.', status: 'PUBLISHED', publishedAt: new Date() },
        { slug: 'terms-of-service', version: 1, title: 'Terms of Service', body: '# Terms\n\nDraft.', status: 'DRAFT' },
      ],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists only public pets of active owners, and published legal documents, without signing in', async () => {
    const s = await sitemap();
    expect(s.pets.map((p: { key: string }) => p.key)).toEqual(['public.pup']);
    expect(s.legal.map((p: { key: string }) => p.key)).toEqual(['privacy-policy']);
    expect(Date.parse(s.pets[0].updatedAt)).not.toBeNaN();
    // Nothing about people, ever.
    expect(JSON.stringify(s)).not.toMatch(/Owner|\+9198/);
  });

  it('lists a marketplace only while it is switched on', async () => {
    await flag('ENABLE_SERVICES', false);
    expect((await sitemap()).services).toEqual([]);
    await flag('ENABLE_SERVICES', true);
    expect((await sitemap()).services.map((p: { key: string }) => p.key)).toEqual(['happy-paws-pune']);
    for (const f of ['ENABLE_MARKETPLACE', 'ENABLE_CONTESTS']) await flag(f, false);
    const s = await sitemap();
    expect([s.products, s.contests, s.challenges]).toEqual([[], [], []]);
  });

  it('is cached, so crawlers can’t load the database', async () => {
    await sitemap();
    await prisma.pet.updateMany({ where: { handle: 'public.pup' }, data: { visibility: 'PRIVATE' } });
    const cached = (await http().get(`${API}/public/sitemap`).expect(200)).body.data;
    expect(cached.pets).toHaveLength(1);
    expect((await sitemap()).pets).toHaveLength(0);
  });
});
