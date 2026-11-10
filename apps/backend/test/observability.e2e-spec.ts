import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { syncRbac } from '../src/modules/rbac/rbac.seed';

process.env.METRICS_TOKEN = 'metrics-token-for-tests-123';
jest.setTimeout(60_000);

describe('Observability (e2e): health, readiness, request ids and metrics', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await new S3Client({
      endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
    }).send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET, CreateBucketConfiguration: { LocationConstraint: 'ap-south-1' } })).catch(() => undefined);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await syncRbac(prisma);
  });

  async function staff(role: string) {
    const email = `${role.toLowerCase()}-${Date.now()}@obs.test`;
    const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash('Staff-Password-1', 10), roles: { create: [{ roleId: r.id }] } } });
    const k = await app.get(RedisService).client.keys('throttle:*');
    if (k.length) await app.get(RedisService).client.del(...k);
    return (await http().post('/api/v1/admin/auth/login').send({ email, password: 'Staff-Password-1' }).expect(200)).body.data.tokens.accessToken as string;
  }
  afterAll(async () => app.close());

  it('/health and /ready answer without a token or API prefix', async () => {
    expect((await http().get('/health').expect(200)).body.data).toMatchObject({ status: 'ok' });
    const ready = (await http().get('/ready').expect(200)).body.data;
    expect(ready).toMatchObject({ status: 'ready', checks: { database: { ok: true }, redis: { ok: true }, storage: { ok: true } } });
  });

  it('every response carries a request id; a sane incoming one is kept, anything else replaced', async () => {
    const own = await http().get('/health').set('X-Request-Id', 'trace-abc-12345');
    expect(own.headers['x-request-id']).toBe('trace-abc-12345');
    const bad = await http().get('/health').set('X-Request-Id', '<script>alert(1)</script>');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const err = await http().get('/api/v1/posts/00000000-0000-0000-0000-000000000000').expect(404);
    expect(err.body.requestId).toBe(err.headers['x-request-id']);
  });

  it('/metrics needs the token, and reports traffic by route pattern, queues, the database and payments', async () => {
    await http().get('/metrics').expect(403);
    await http().get('/metrics').set('Authorization', 'Bearer wrong-token-wrong-token').expect(403);
    await http().get('/api/v1/posts/11111111-1111-1111-1111-111111111111').expect(404);
    await http().get('/api/v1/no-such-thing/22222222-2222-2222-2222-222222222222').expect(404);
    const r = await http().get('/metrics').set('Authorization', 'Bearer metrics-token-for-tests-123').expect(200);
    expect(r.headers['content-type']).toMatch(/text\/plain/);
    const text = r.text;
    expect(text).toMatch(/petapp_http_requests_total\{method="GET",route="\/api\/v1\/posts\/:id",status="404"\} \d+/);
    expect(text).toMatch(/petapp_http_requests_total\{method="GET",route="unmatched",status="404"\}/);
    expect(text).not.toMatch(/11111111-1111/); // ids never become labels
    expect(text).toMatch(/petapp_http_request_duration_seconds_bucket\{le="0.1",method="GET",route="\/api\/v1\/posts\/:id",status_class="4xx"\}/);
    expect(text).toMatch(/petapp_queue_jobs\{queue="media",state="waiting"\} \d+/);
    expect(text).toMatch(/petapp_db_up 1/);
    expect(text).toMatch(/petapp_payment_webhooks_unprocessed \d+/);
    expect(text).toMatch(/petapp_money_attention\{kind="refunds_overdue"\} \d+/);
    expect(text).toMatch(/petapp_api_process_resident_memory_bytes/);
  });

  it('the System page: dependencies, queues with recent failures, providers and money needing attention', async () => {
    const admin = await staff('SUPER_ADMIN');
    const s = (await http().get('/api/v1/admin/system').set('Authorization', `Bearer ${admin}`).expect(200)).body.data;
    expect(s).toMatchObject({ environment: 'test', checks: { database: { ok: true }, redis: { ok: true } }, providers: { payments: 'fake', sms: 'console', metrics: 'token set' } });
    expect(s.queues[0]).toMatchObject({ counts: { waiting: expect.any(Number), failed: expect.any(Number) }, recentFailures: expect.any(Array) });
    expect(s.queues.map((q: { name: string }) => q.name)).toEqual(['media', 'maintenance', 'notifications', 'trust']);
    expect(s.money).toEqual({ refundsFailed: expect.any(Number), payoutsFailed: expect.any(Number), refundsOverdue: expect.any(Number), webhooksUnprocessed: expect.any(Number) });
    const r = (await http().post('/api/v1/admin/system/queues/media/retry').set('Authorization', `Bearer ${admin}`).expect(200)).body.data;
    expect(r.retried).toBeGreaterThanOrEqual(0);
    await http().post('/api/v1/admin/system/queues/nope/retry').set('Authorization', `Bearer ${admin}`).expect(400);
    const mod = await staff('MODERATOR');
    await http().get('/api/v1/admin/system').set('Authorization', `Bearer ${mod}`).expect(403);
    expect(await prisma.auditLog.count({ where: { action: 'system.queue_retry' } })).toBeGreaterThan(0);
  });
});
