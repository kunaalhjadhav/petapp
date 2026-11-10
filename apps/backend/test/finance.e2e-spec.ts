import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { SMS_PROVIDER, type SmsMessage } from '../src/providers/sms/sms.provider';
import { PUSH_PROVIDER } from '../src/providers/push/push.provider';
import { FakePaymentProvider } from '../src/providers/payments/payment.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { WorkerModule } from '../src/worker/worker.module';
import { FinanceService } from '../src/modules/finance/finance.service';
import { RefundExecutor } from '../src/modules/finance/refund-executor.service';
import { refundReceipt, splitEarning } from '../src/modules/finance/finance.rules';
import { QueueService } from '../src/queue/queue.service';

const API = '/api/v1';
jest.setTimeout(150_000);
type User = { token: string; id: string };
type Buyer = User & { addressId: string };
const BANDRA = { lat: 19.0596, lng: 72.8295 };
const indiaDate = (days: number) => new Date(Date.now() + days * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);

describe('Finance (e2e): ledger, refunds, reconciliation', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  let refunds: RefundExecutor;
  const inbox = new Map<string, string>();
  let admin: string;
  let seller: User;
  let sellerId: string;
  let jerky: string; // ₹299, 18% GST, category commission 12%
  let buyer: Buyer;
  let partner: User;
  let partnerId: string;
  let serviceId: string;
  let petId: string;
  const parcels: Record<string, { subOrderId: string; paymentId: string; orderId: string }> = {};

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const unthrottle = async () => {
    const k = await redis.client.keys('throttle:*');
    if (k.length) await redis.client.del(...k);
  };
  async function login(phone: string, name: string): Promise<User> {
    await unthrottle();
    await http().post(`${API}/auth/otp/request`).send({ phone }).expect(200);
    const r = await http().post(`${API}/auth/otp/verify`).send({ phone, code: inbox.get(phone) }).expect(200);
    const u = { token: r.body.data.tokens.accessToken, id: r.body.data.user.id };
    await http().patch(`${API}/users/me`).set(bearer(u.token)).send({ name }).expect(200);
    return u;
  }
  const doc = (ownerId: string, kind: 'IMAGE' | 'DOCUMENT' = 'DOCUMENT') =>
    prisma.mediaAsset.create({ data: { ownerId, kind, mimeType: kind === 'IMAGE' ? 'image/jpeg' : 'application/pdf', sizeBytes: 1000, storageKey: `uploads/${ownerId}/${Math.random()}`, status: 'READY', variants: {} } });
  const pay = (u: User, paymentId: string) => http().post(`${API}/payments/${paymentId}/simulate`).set(bearer(u.token)).expect(200);
  const webhook = (body: object, eventId: string) => {
    const raw = JSON.stringify(body);
    return http().post(`${API}/webhooks/payments`).set('Content-Type', 'application/json').set('x-razorpay-event-id', eventId).set('x-razorpay-signature', FakePaymentProvider.signWebhook(raw)).send(raw);
  };

  /** Buys `qty` jerky and pays; returns the parcel. */
  async function buy(key: string, qty: number, couponCode?: string) {
    await http().put(`${API}/cart/items`).set(bearer(buyer.token)).send({ variantId: jerky, qty }).expect(200);
    const r = (await http().post(`${API}/orders`).set(bearer(buyer.token)).send({ addressId: buyer.addressId, couponCode }).expect(201)).body.data;
    await pay(buyer, r.payment.paymentId);
    parcels[key] = { subOrderId: r.order.parcels[0].id, paymentId: r.payment.paymentId, orderId: r.order.id };
    return parcels[key];
  }
  const deliver = async (id: string) => {
    await http().post(`${API}/vendor/orders/${id}/pack`).set(bearer(seller.token)).expect(200);
    await http().post(`${API}/vendor/orders/${id}/ship`).set(bearer(seller.token)).send({ courier: 'Delhivery', trackingNumber: 'DL1234567' }).expect(200);
    await http().post(`${API}/vendor/orders/${id}/deliver`).set(bearer(seller.token)).expect(200);
  };
  /** Lines of one posting: account code → net (debit − credit). */
  async function posting(reference: string) {
    const t = await prisma.ledgerTransaction.findUnique({ where: { reference }, include: { entries: { include: { account: true } } } });
    if (!t) return null;
    const net: Record<string, number> = {};
    for (const e of t.entries) net[e.account.code] = (net[e.account.code] ?? 0) + e.debitPaise - e.creditPaise;
    return net;
  }
  const trialBalanced = async () => (await http().get(`${API}/admin/finance/trial-balance`).set(bearer(admin)).expect(200)).body.data.totals.balanced as boolean;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({ name: 'capture', send: async (m: SmsMessage) => (inbox.set(m.to, m.body.match(/\d{6}/)![0]), {}) })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    refunds = app.get(RefundExecutor);
    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    // TRUNCATE (test reset only) doesn't fire the ledger's row-level append-only guards.
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    await prisma.featureFlag.createMany({ data: [{ key: 'ENABLE_MARKETPLACE', enabled: true }, { key: 'ENABLE_SERVICES', enabled: true }] });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    await prisma.user.create({ data: { email: 'root@fin.test', passwordHash: await bcrypt.hash('Root-Password-1', 10), roles: { create: [{ roleId: role.id }] } } });
    admin = (await http().post(`${API}/admin/auth/login`).send({ email: 'root@fin.test', password: 'Root-Password-1' }).expect(200)).body.data.tokens.accessToken;

    // A GST-registered seller with a PAN, selling ₹299 treats (18% GST) in a 12% category.
    const treats = (await http().post(`${API}/admin/product-categories`).set(bearer(admin)).send({ key: 'treats', name: 'Treats', commissionBps: 1200 }).expect(201)).body.data.id;
    seller = await login('+919700000001', 'Wag & Co');
    sellerId = (await http().post(`${API}/vendor/profile`).set(bearer(seller.token)).send({ businessName: 'Wag & Co', phone: '9700000001', addressLine: '7 Baner Road', city: 'Pune', state: 'Maharashtra', pincode: '411045', gstin: '27ABCDE1234F1Z5', pan: 'abcde1234f' }).expect(201)).body.data.id;
    for (const kind of ['ID_PROOF', 'GST_CERTIFICATE']) await http().post(`${API}/vendor/documents`).set(bearer(seller.token)).send({ kind, mediaId: (await doc(seller.id)).id }).expect(201);
    await http().post(`${API}/vendor/submit`).set(bearer(seller.token)).expect(200);
    const docs = (await http().get(`${API}/admin/vendors/${sellerId}`).set(bearer(admin)).expect(200)).body.data.documents as Array<{ id: string }>;
    await http().post(`${API}/admin/vendors/${sellerId}/review`).set(bearer(admin)).send({ decision: 'APPROVE', documents: docs.map((d) => ({ id: d.id, status: 'ACCEPTED' })) }).expect(200);
    const p = (await http().post(`${API}/vendor/products`).set(bearer(seller.token)).send({
      categoryId: treats, title: 'Chicken Jerky', description: 'Single-ingredient treats.', imageIds: [(await doc(seller.id, 'IMAGE')).id],
      variants: [{ sku: 'CJ-100', title: '100 g', mrpPaise: 34900, pricePaise: 29900, gstRateBps: 1800, stock: 50 }],
    }).expect(201)).body.data;
    jerky = p.variants[0].id;
    await http().patch(`${API}/vendor/products/${p.id}`).set(bearer(seller.token)).send({ status: 'ACTIVE' }).expect(200);
    await http().post(`${API}/admin/coupons`).set(bearer(admin)).send({ code: 'PETAPP10', kind: 'PERCENT', value: 1000, startsAt: hours(-1), endsAt: hours(48), perUserLimit: 5 }).expect(201);

    const b = await login('+919700000002', 'Ravi Buyer');
    const a = await http().post(`${API}/users/me/addresses`).set(bearer(b.token)).send({ label: 'Home', line1: '21 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' }).expect(201);
    buyer = { ...b, addressId: a.body.data.id };

    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(PUSH_PROVIDER).useValue({ name: 'none', send: async () => 'sent' }).compile();
    await worker.init();
    // Refunds are swept explicitly here, so the worker's 30-second sweep is switched off for this suite.
    await app.get(QueueService).maintenance.removeJobScheduler('process-refunds');
  });

  beforeEach(async () => {
    await unthrottle();
    FakePaymentProvider.refundMode = 'processed';
  });
  afterAll(async () => {
    FakePaymentProvider.refundMode = 'processed';
    await worker.close();
    await app.close();
  });

  it('the database itself keeps the ledger honest: balanced, one-sided lines, append-only', async () => {
    const acct = await prisma.ledgerAccount.create({ data: { code: 'TEST_A', name: 'Test A', type: 'ASSET' } });
    const acct2 = await prisma.ledgerAccount.create({ data: { code: 'TEST_B', name: 'Test B', type: 'LIABILITY' } });
    const tx = async (lines: Array<[string, number, number]>) =>
      prisma.$transaction(async (t) => {
        const x = await t.ledgerTransaction.create({ data: { kind: 'TEST', reference: `test:${Math.random()}`, memo: 'test' } });
        await t.ledgerEntry.createMany({ data: lines.map(([accountId, debitPaise, creditPaise]) => ({ transactionId: x.id, accountId, debitPaise, creditPaise })) });
      });
    await expect(tx([[acct.id, 100, 0], [acct2.id, 0, 99]])).rejects.toThrow(/unbalanced/);
    await expect(tx([[acct.id, 100, 0]])).rejects.toThrow(/at least 2/);
    await expect(tx([[acct.id, 100, 100], [acct2.id, 0, 0]])).rejects.toThrow(/one_side/);
    await expect(tx([[acct.id, -5, 0], [acct2.id, 0, -5]])).rejects.toThrow(/one_side/);
    await tx([[acct.id, 100, 0], [acct2.id, 0, 100]]);
    const e = await prisma.ledgerEntry.findFirstOrThrow({ where: { accountId: acct.id } });
    await expect(prisma.ledgerEntry.update({ where: { id: e.id }, data: { debitPaise: 1 } })).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerEntry.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerTransaction.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await trialBalanced()).toBe(true);
  });

  it('a delivered parcel pays the seller after commission (with its GST), TCS and TDS — to the paisa', async () => {
    const a = await buy('A', 1);
    // Captured: the gateway holds it for the customer.
    expect(await posting(`capture:Payment:${a.paymentId}`)).toEqual({ GATEWAY_CLEARING: 34800, CUSTOMER_FUNDS: -34800 });
    await deliver(a.subOrderId);
    // ₹299 + ₹49 shipping. Commission 12% of ₹299 = ₹35.88, of which ₹5.47 is GST. Taxable value ₹253.39
    // (₹299 less 18% GST inside it): TCS 0.5% = ₹1.27, TDS 0.1% (PAN on file) = ₹0.25.
    expect(await posting(`earn:SubOrder:${a.subOrderId}`)).toEqual({
      CUSTOMER_FUNDS: 34800, FEE_REVENUE: -3041, GST_PAYABLE: -547, TCS_PAYABLE: -127, TDS_PAYABLE: -25, [`VENDOR:${sellerId}`]: -31060,
    });
    // Delivering twice can't post twice (and the API refuses the second delivery anyway).
    await http().post(`${API}/vendor/orders/${a.subOrderId}/deliver`).set(bearer(seller.token)).expect(400);
    const again = await prisma.$transaction((tx) => app.get(FinanceService).parcelDelivered(tx, a.subOrderId));
    expect(again).toBe(false);
    expect(await prisma.ledgerTransaction.count({ where: { reference: `earn:SubOrder:${a.subOrderId}` } })).toBe(1);
  });

  it('a PetApp-funded coupon is PetApp’s cost; a return reverses the sale and refunds the customer', async () => {
    const b = await buy('B', 2, 'PETAPP10');
    const s = await prisma.subOrder.findUniqueOrThrow({ where: { id: b.subOrderId } });
    expect(s).toMatchObject({ itemsPaise: 59800, discountPaise: 5980, shippingPaise: 0, totalPaise: 53820, commissionPaise: 7176, vendorEarningPaise: 52624 });
    await deliver(b.subOrderId);
    const earn = await posting(`earn:SubOrder:${b.subOrderId}`);
    const split = splitEarning({ customerPaise: 53820, platformDiscountPaise: 5980, feePaise: 7176, taxableBasePaise: 53820 - 8210, gstOnFeesBps: 1800, tcsBps: 50, tdsBps: 10 });
    expect(earn).toEqual({
      CUSTOMER_FUNDS: 53820, PLATFORM_DISCOUNTS: 5980, FEE_REVENUE: -split.feeRevenuePaise, GST_PAYABLE: -split.feeGstPaise,
      TCS_PAYABLE: -split.tcsPaise, TDS_PAYABLE: -split.tdsPaise, [`VENDOR:${sellerId}`]: -split.payeeNetPaise,
    });
    expect(split).toMatchObject({ tcsPaise: 228, tdsPaise: 46, payeeNetPaise: 52350 });

    await http().post(`${API}/sub-orders/${b.subOrderId}/return`).set(bearer(buyer.token)).send({ reason: 'Dog didn’t like them' }).expect(200);
    const ret = await prisma.returnRequest.findFirstOrThrow({ where: { subOrderId: b.subOrderId } });
    await http().post(`${API}/vendor/returns/${ret.id}/decide`).set(bearer(seller.token)).send({ decision: 'APPROVE' }).expect(200);
    await http().post(`${API}/vendor/returns/${ret.id}/decide`).set(bearer(seller.token)).send({ decision: 'RECEIVED' }).expect(200);
    // The sale is undone line for line (nothing shipping-related to keep: it shipped free).
    const reversal = await posting(`earn-reversal:SubOrder:${b.subOrderId}`);
    expect(reversal).toEqual(Object.fromEntries(Object.entries(earn!).map(([k, v]) => [k, -v])));
    const refund = await prisma.refund.findUniqueOrThrow({ where: { reference: `Return:${ret.id}` } });
    expect(refund).toMatchObject({ amountPaise: 53820, status: 'PENDING' });
    expect(await posting(`refund-owed:Refund:${refund.id}`)).toEqual({ CUSTOMER_FUNDS: 53820, REFUNDS_DUE: -53820 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: b.paymentId } })).status).toBe('REFUND_PENDING');
  });

  it('a cancelled parcel is refunded; the refund goes to the gateway and the customer hears about it', async () => {
    const c = await buy('C', 1);
    await http().post(`${API}/sub-orders/${c.subOrderId}/cancel`).set(bearer(buyer.token)).send({ reason: 'Ordered by mistake' }).expect(200);
    const owed = await prisma.refund.findUniqueOrThrow({ where: { reference: `SubOrder:${c.subOrderId}` } });
    expect(owed.amountPaise).toBe(34800);

    await refunds.sweep();
    const done = await prisma.refund.findUniqueOrThrow({ where: { id: owed.id } });
    expect(done).toMatchObject({ status: 'PROCESSED', attempts: 1 });
    expect(done.providerRefundId).toMatch(/^fake_rfnd_/);
    expect(await posting(`refund-paid:Refund:${owed.id}`)).toEqual({ REFUNDS_DUE: 34800, GATEWAY_CLEARING: -34800 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).status).toBe('REFUNDED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: parcels.B.paymentId } })).status).toBe('REFUNDED');
    // The gateway was asked once, with a receipt made from our refund id and the attempt number.
    const gw = await FakePaymentProvider.prototype.listRefunds.call(null, (await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).providerPaymentId!);
    expect(gw).toEqual([expect.objectContaining({ receipt: refundReceipt(owed.id, 1), amountPaise: 34800, status: 'processed' })]);

    for (let i = 0; i < 60; i++) {
      const items = (await http().get(`${API}/notifications?limit=50`).set(bearer(buyer.token)).expect(200)).body.data.items as Array<{ type: string; body: string; entityType: string }>;
      const n = items.find((x) => x.type === 'REFUND_PROCESSED' && x.body.includes('₹348'));
      if (n) {
        expect(n.body).toMatch(/₹348 for order .* is on its way back to your original payment method/);
        break;
      }
      if (i === 59) throw new Error('no refund notification');
      await new Promise((r) => setTimeout(r, 150));
    }
    // Sweeping again does nothing: processed refunds aren't sent twice.
    expect((await refunds.sweep()).processed).toBe(0);

    // The customer sees their refunds in the app, with what each was for. Nobody else sees them.
    const mine = (await http().get(`${API}/me/refunds`).set(bearer(buyer.token)).expect(200)).body;
    const row = mine.data.find((r: { id: string }) => r.id === owed.id);
    expect(row).toMatchObject({ amountPaise: 34800, reason: 'SUB_ORDER_CANCELLED', status: 'PROCESSED', reference: done.providerRefundId, about: { kind: 'ORDER', title: expect.stringMatching(/^Order /) } });
    expect(mine.meta).toMatchObject({ page: 1 });
    const theirs = (await http().get(`${API}/me/refunds`).set(bearer(seller.token)).expect(200)).body.data;
    expect(theirs.find((r: { id: string }) => r.id === owed.id)).toBeUndefined();
  });

  it('refund failures: outages retry with backoff, refusals stop for staff; a webhook completes a pending refund', async () => {
    const d = await buy('D', 1);
    await http().post(`${API}/sub-orders/${d.subOrderId}/cancel`).set(bearer(buyer.token)).send({ reason: 'Changed my mind' }).expect(200);
    const r = await prisma.refund.findUniqueOrThrow({ where: { reference: `SubOrder:${d.subOrderId}` } });

    FakePaymentProvider.refundMode = 'outage';
    expect(await refunds.attempt(r.id)).toBe('retrying');
    let row = await prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: expect.stringMatching(/temporarily unavailable/) });
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 60_000); // 2 minutes out
    expect(await refunds.attempt(r.id)).toBe('skipped'); // not due yet

    await prisma.refund.update({ where: { id: r.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    FakePaymentProvider.refundMode = 'refuse';
    expect(await refunds.attempt(r.id)).toBe('failed');
    row = await prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 2 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: d.paymentId } })).status).toBe('REFUND_PENDING'); // still owed
    const failedList = (await http().get(`${API}/admin/finance/refunds?status=FAILED`).set(bearer(admin)).expect(200)).body.data;
    expect(failedList.map((x: { id: string }) => x.id)).toEqual([r.id]);

    // Staff retry; the gateway accepts it but takes a while; its webhook completes it.
    await http().post(`${API}/admin/finance/refunds/${r.id}/retry`).set(bearer(admin)).expect(200);
    await http().post(`${API}/admin/finance/refunds/${r.id}/retry`).set(bearer(admin)).expect(404); // not failed any more
    FakePaymentProvider.refundMode = 'pending';
    expect(await refunds.attempt(r.id)).toBe('pending');
    row = await prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('PROCESSING');
    const paymentGatewayId = (await prisma.payment.findUniqueOrThrow({ where: { id: d.paymentId } })).providerPaymentId!;
    const event = { event: 'refund.processed', payload: { refund: { entity: { id: row.providerRefundId, payment_id: paymentGatewayId, amount: 34800, status: 'processed' } } } };
    expect((await webhook(event, `evt_${r.id}`).expect(200)).body.data.status).toBe('refund_processed:processed');
    expect((await webhook(event, `evt_${r.id}`).expect(200)).body.data.status).toBe('duplicate');
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'PROCESSED' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: d.paymentId } })).status).toBe('REFUNDED');
    expect(await prisma.ledgerTransaction.count({ where: { reference: `refund-paid:Refund:${r.id}` } })).toBe(1);
    // A retried request after a lost response finds the earlier refund by its receipt instead of refunding twice.
    expect((await FakePaymentProvider.prototype.listRefunds.call(null, paymentGatewayId)).length).toBe(1);
  });

  it('a refund the gateway failed is tried again with a new receipt; stale reports change nothing; staff can record a manual refund', async () => {
    const e = await buy('E', 1);
    await http().post(`${API}/sub-orders/${e.subOrderId}/cancel`).set(bearer(buyer.token)).send({ reason: 'Too slow' }).expect(200);
    const r = await prisma.refund.findUniqueOrThrow({ where: { reference: `SubOrder:${e.subOrderId}` } });
    const gatewayPaymentId = (await prisma.payment.findUniqueOrThrow({ where: { id: e.paymentId } })).providerPaymentId!;

    FakePaymentProvider.refundMode = 'pending';
    expect(await refunds.attempt(r.id)).toBe('pending');
    const first = (await prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).providerRefundId!;
    // A stale "failed" about some other refund id is ignored while this attempt is in flight.
    expect(await refunds.apply(r.id, { refundId: 'fake_rfnd_other', status: 'failed' })).toBe('skipped');
    // The bank rejects it; the gateway says so.
    FakePaymentProvider.settle(first, 'failed');
    const failed = { event: 'refund.failed', payload: { refund: { entity: { id: first, payment_id: gatewayPaymentId, amount: 34800, status: 'failed' } } } };
    expect((await webhook(failed, `evt_f_${r.id}`).expect(200)).body.data.status).toBe('refund_failed:retrying');
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'PENDING', attempts: 1 });
    await prisma.refund.update({ where: { id: r.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    FakePaymentProvider.refundMode = 'processed';
    expect(await refunds.attempt(r.id)).toBe('processed');
    const atGateway = await FakePaymentProvider.prototype.listRefunds.call(null, gatewayPaymentId);
    expect(atGateway.map((g) => g.status)).toEqual(['failed', 'processed']);
    expect(new Set(atGateway.map((g) => g.receipt)).size).toBe(2); // a fresh receipt for the second attempt

    // The gateway refuses outright: staff pay the customer by bank transfer and record it.
    const f = await buy('F', 1);
    await http().post(`${API}/sub-orders/${f.subOrderId}/cancel`).set(bearer(buyer.token)).send({ reason: 'Wrong item' }).expect(200);
    const rf = await prisma.refund.findUniqueOrThrow({ where: { reference: `SubOrder:${f.subOrderId}` } });
    FakePaymentProvider.refundMode = 'refuse';
    expect(await refunds.attempt(rf.id)).toBe('failed');
    await http().post(`${API}/admin/finance/refunds/${rf.id}/settle-manually`).set(bearer(admin)).send({ reference: 'x' }).expect(400);
    const settled = (await http().post(`${API}/admin/finance/refunds/${rf.id}/settle-manually`).set(bearer(admin)).send({ reference: 'NEFT UTR SBIN0000123' }).expect(200)).body.data;
    expect(settled).toMatchObject({ status: 'SETTLED_MANUALLY', manualReference: 'NEFT UTR SBIN0000123' });
    await http().post(`${API}/admin/finance/refunds/${rf.id}/settle-manually`).set(bearer(admin)).send({ reference: 'NEFT UTR SBIN0000123' }).expect(404); // once
    expect(await posting(`refund-paid:Refund:${rf.id}`)).toEqual({ REFUNDS_DUE: 34800, BANK: -34800 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })).status).toBe('REFUNDED');
    expect(await refunds.retry('x', rf.id)).toBe(false); // nothing to retry any more
  });

  it('a webhook whose handling failed last time is handled when the gateway sends it again', async () => {
    const g = await buy('G', 1);
    const pg = await prisma.payment.findUniqueOrThrow({ where: { id: g.paymentId } });
    // Pretend a refund is in flight whose completion webhook was received once but not handled.
    await http().post(`${API}/sub-orders/${g.subOrderId}/cancel`).set(bearer(buyer.token)).send({ reason: 'Not needed' }).expect(200);
    const r = await prisma.refund.findUniqueOrThrow({ where: { reference: `SubOrder:${g.subOrderId}` } });
    FakePaymentProvider.refundMode = 'pending';
    await refunds.attempt(r.id);
    const rid = (await prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).providerRefundId!;
    await prisma.paymentWebhookEvent.create({ data: { provider: 'fake', eventId: 'evt_lost_once', type: 'refund_processed', payload: {} } });
    const body = { event: 'refund.processed', payload: { refund: { entity: { id: rid, payment_id: pg.providerPaymentId, amount: 34800, status: 'processed' } } } };
    expect((await webhook(body, 'evt_lost_once').expect(200)).body.data.status).toBe('refund_processed:processed');
    expect((await webhook(body, 'evt_lost_once').expect(200)).body.data.status).toBe('duplicate');
  });

  it('refunds on one payment can never add up to more than was paid', async () => {
    const finance = app.get(FinanceService);
    await expect(
      prisma.$transaction((tx) => finance.oweRefund(tx, { paymentId: parcels.A.paymentId, amountPaise: 34801, reason: 'GOODWILL', reference: `Test:${parcels.A.paymentId}` })),
    ).rejects.toThrow(/exceed what was paid/);
    expect(await prisma.refund.count({ where: { paymentId: parcels.A.paymentId } })).toBe(0);
    // A refund for something unpaid is simply not owed.
    const unpaid = await prisma.payment.create({ data: { userId: buyer.id, purpose: 'PRODUCT_ORDER', referenceId: parcels.A.orderId, amountPaise: 100, provider: 'fake', providerOrderId: `fake_order_unpaid_${Date.now()}` } });
    expect(await prisma.$transaction((tx) => finance.oweRefund(tx, { paymentId: unpaid.id, amountPaise: 100, reason: 'TEST', reference: `Test:${unpaid.id}` }))).toBeNull();
  });

  it('service partners: a completed visit and a late cancellation earn after fee and TDS (higher rate without a PAN)', async () => {
    const dog = await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } });
    const grooming = (await http().post(`${API}/admin/service-categories`).set(bearer(admin)).send({ key: 'grooming', name: 'Grooming', commissionBps: 1500 }).expect(201)).body.data.id;
    partner = await login('+919700000003', 'Priya Groomer');
    partnerId = (await http().post(`${API}/partner/profile`).set(bearer(partner.token)).send({ businessName: 'Pawfect', kind: 'INDIVIDUAL', phone: '9700000003', addressLine: '12 Hill Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400050', ...BANDRA }).expect(201)).body.data.id;
    await http().post(`${API}/partner/documents`).set(bearer(partner.token)).send({ kind: 'ID_PROOF', mediaId: (await doc(partner.id)).id }).expect(201);
    serviceId = (await http().post(`${API}/partner/services`).set(bearer(partner.token)).send({ categoryId: grooming, name: 'Full groom', durationMin: 60, bufferMin: 0, pricePaise: 79900, modes: ['AT_CENTER'], speciesIds: [dog.id] }).expect(201)).body.data.services[0].id;
    await http().put(`${API}/partner/hours`).set(bearer(partner.token)).send({ hours: Array.from({ length: 7 }, (_, d) => ({ weekday: d, opensMin: 0, closesMin: 1440 })) }).expect(200);
    await http().post(`${API}/partner/submit`).set(bearer(partner.token)).expect(200);
    const docId = (await http().get(`${API}/admin/partners/${partnerId}`).set(bearer(admin)).expect(200)).body.data.documents[0].id;
    await http().post(`${API}/admin/partners/${partnerId}/review`).set(bearer(admin)).send({ decision: 'APPROVE', documents: [{ id: docId, status: 'ACCEPTED' }] }).expect(200);
    petId = (await http().post(`${API}/pets`).set(bearer(buyer.token)).send({ name: 'Bruno', speciesId: dog.id }).expect(201)).body.data.id;

    const free: string[] = [];
    for (const day of [indiaDate(0), indiaDate(1)]) {
      const s = (await http().get(`${API}/partner-services/${serviceId}/slots?date=${day}`).expect(200)).body.data.slots as Array<{ startsAt: string }>;
      free.push(...s.map((x) => x.startsAt));
    }
    const soon = free.filter((t) => Date.parse(t) > Date.now() + 2 * 3_600_000 && Date.parse(t) < Date.now() + 20 * 3_600_000);
    const book = async (startsAt: string) => {
      const b = (await http().post(`${API}/bookings`).set(bearer(buyer.token)).send({ serviceId, petId, startsAt, mode: 'AT_CENTER' }).expect(201)).body.data;
      await pay(buyer, b.payment.paymentId);
      return b as { id: string; payment: { paymentId: string } };
    };
    const visit = await book(soon[0]);
    const late = await book(soon[2]);

    // The visit happened (moved into the past so it can be completed now).
    await prisma.booking.update({ where: { id: visit.id }, data: { startsAt: new Date(Date.now() - 2 * 3_600_000), endsAt: new Date(Date.now() - 3_600_000) } });
    await http().post(`${API}/partner/bookings/${visit.id}/complete`).set(bearer(partner.token)).expect(200);
    // ₹799, fee 15% = ₹119.85 (₹18.28 GST inside). Not GST-registered: no TCS. No PAN: TDS 5% = ₹39.95.
    expect(await posting(`earn:Booking:${visit.id}`)).toEqual({
      CUSTOMER_FUNDS: 79900, FEE_REVENUE: -10157, GST_PAYABLE: -1828, TDS_PAYABLE: -3995, [`PARTNER:${partnerId}`]: -63920,
    });

    // Cancelled by the customer within 24 hours: half refunded, the partner keeps the other half less the fee.
    expect((await http().post(`${API}/bookings/${late.id}/cancel`).set(bearer(buyer.token)).send({}).expect(200)).body.data.refundPaise).toBe(39950);
    expect(await prisma.refund.findUniqueOrThrow({ where: { reference: `Booking:${late.id}` } })).toMatchObject({ amountPaise: 39950, status: 'PENDING' });
    expect(await posting(`earn:Booking:${late.id}`)).toEqual({
      CUSTOMER_FUNDS: 39950, FEE_REVENUE: -5079, GST_PAYABLE: -914, TDS_PAYABLE: -1998, [`PARTNER:${partnerId}`]: -31959,
    });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: late.payment.paymentId } })).status).toBe('CAPTURED'); // half refund owed, not sent yet
    await refunds.sweep();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: late.payment.paymentId } })).status).toBe('PARTIALLY_REFUNDED');

    // The partner's earnings show what PetApp owes them; their statement explains each line.
    const e = (await http().get(`${API}/partner/earnings`).set(bearer(partner.token)).expect(200)).body.data;
    expect(e.balancePaise).toBe(63920 + 31959);
    const st = (await http().get(`${API}/partner/statement`).set(bearer(partner.token)).expect(200)).body.data;
    expect(st.balancePaise).toBe(95879);
    expect(st.totals).toEqual({ earnedPaise: 95879, paidOutPaise: 0, tcsPaise: 0, tdsPaise: 3995 + 1998, feesPaise: 11985 + 5993 });
    const lateLine = st.items.find((x: { sourceId: string }) => x.sourceId === late.id);
    expect(lateLine).toMatchObject({ kind: 'BOOKING_EARNED', amountPaise: 31959, salePaise: 39950, feePaise: 5993, tdsPaise: 1998, tcsPaise: 0 });
    expect(lateLine.memo).toMatch(/Late cancellation/);
    await http().get(`${API}/vendor/statement`).set(bearer(partner.token)).expect(404); // not a seller

    // Completing and cancelling the same visit at once: exactly one wins, and the money follows that one.
    const race = await book(soon[4]);
    await prisma.booking.update({ where: { id: race.id }, data: { startsAt: new Date(Date.now() - 4 * 3_600_000), endsAt: new Date(Date.now() - 3 * 3_600_000) } });
    const [done, cancelled] = await Promise.all([
      http().post(`${API}/partner/bookings/${race.id}/complete`).set(bearer(partner.token)),
      http().post(`${API}/bookings/${race.id}/cancel`).set(bearer(buyer.token)).send({}),
    ]);
    expect([done.status, cancelled.status].filter((x) => x === 200)).toHaveLength(1);
    const final = await prisma.booking.findUniqueOrThrow({ where: { id: race.id } });
    const earned = await posting(`earn:Booking:${race.id}`);
    const refund = await prisma.refund.findUnique({ where: { reference: `Booking:${race.id}` } });
    if (final.status === 'COMPLETED') {
      expect(earned?.[`PARTNER:${partnerId}`]).toBe(-63920);
      expect(refund).toBeNull();
    } else {
      expect(final.status).toBe('CANCELLED'); // after the start: nothing refunded, the partner keeps the price
      expect(final.refundPaise).toBe(0);
      expect(refund).toBeNull();
      expect(earned?.[`PARTNER:${partnerId}`]).toBe(-63920);
    }
  });

  it('sellers see their balance and a line-by-line statement', async () => {
    const e = (await http().get(`${API}/vendor/earnings`).set(bearer(seller.token)).expect(200)).body.data;
    expect(e.balancePaise).toBe(31060); // parcel A; parcel B was returned
    const st = (await http().get(`${API}/vendor/statement?limit=10`).set(bearer(seller.token)).expect(200)).body.data;
    expect(st.balancePaise).toBe(31060);
    const a = st.items.find((x: { kind: string; sourceId: string }) => x.kind === 'PARCEL_DELIVERED' && x.sourceId === parcels.A.subOrderId);
    expect(a).toMatchObject({ amountPaise: 31060, salePaise: 34800, feePaise: 3588, tcsPaise: 127, tdsPaise: 25 });
    const back = st.items.find((x: { kind: string }) => x.kind === 'PARCEL_RETURNED');
    expect(back).toMatchObject({ amountPaise: -52350, tcsPaise: -228, tdsPaise: -46 });
    expect(st.totals).toEqual({ earnedPaise: 31060, paidOutPaise: 0, tcsPaise: 127, tdsPaise: 25, feesPaise: 3588 });
  });

  it('staff reports: overview, trial balance, payees and the monthly TCS/TDS report', async () => {
    await http().get(`${API}/admin/finance/overview`).set(bearer(buyer.token)).expect(403);
    const o = (await http().get(`${API}/admin/finance/overview`).set(bearer(admin)).expect(200)).body.data;
    const captured = await prisma.payment.aggregate({ where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING', 'REFUNDED'] } }, _sum: { amountPaise: true } });
    const sent = await prisma.refund.aggregate({ where: { status: 'PROCESSED' }, _sum: { amountPaise: true } });
    expect(o.now.heldByGatewayPaise).toBe((captured._sum.amountPaise ?? 0) - (sent._sum.amountPaise ?? 0));
    expect(o.now.owedToSellersPaise).toBe(31060);
    expect(o.now.owedToPartnersPaise).toBe(95879 + 63920); // the visit from the race above earns either way
    expect(o.now.tdsPayablePaise).toBe(25 + 3995 + 1998 + 3995);
    expect(o.now.tcsPayablePaise).toBe(127);
    expect(o.flows.platformDiscountsPaise).toBe(0); // given on parcel B, then taken back by its return
    expect(o.refunds.PROCESSED.count).toBeGreaterThanOrEqual(4);

    const tb = (await http().get(`${API}/admin/finance/trial-balance`).set(bearer(admin)).expect(200)).body.data;
    expect(tb.totals.balanced).toBe(true);
    expect(tb.totals.debitPaise).toBeGreaterThan(0);

    const payees = (await http().get(`${API}/admin/finance/accounts?kind=PARTNER`).set(bearer(admin)).expect(200)).body.data;
    expect(payees).toEqual([expect.objectContaining({ code: `PARTNER:${partnerId}`, name: 'Owed to Pawfect', balancePaise: 95879 + 63920 })]);
    const lines = (await http().get(`${API}/admin/finance/accounts/${encodeURIComponent(`VENDOR:${sellerId}`)}/entries`).set(bearer(admin)).expect(200)).body.data;
    expect(lines.account.balancePaise).toBe(31060);
    expect(lines.items.length).toBeGreaterThanOrEqual(3);
    const t = (await http().get(`${API}/admin/finance/transactions/${lines.items[0].transaction.id}`).set(bearer(admin)).expect(200)).body.data;
    expect(t.entries.reduce((a: number, x: { debitPaise: number; creditPaise: number }) => a + x.debitPaise - x.creditPaise, 0)).toBe(0);

    const month = indiaDate(0).slice(0, 7);
    const tax = (await http().get(`${API}/admin/finance/tax-report?month=${month}`).set(bearer(admin)).expect(200)).body.data;
    const wag = tax.payees.find((p: { payeeId: string }) => p.payeeId === sellerId);
    expect(wag).toMatchObject({ gstin: '27ABCDE1234F1Z5', pan: 'ABCDE1234F', taxableValuePaise: 25339, tcsPaise: 127, tdsPaise: 25 });
    const paw = tax.payees.find((p: { payeeId: string }) => p.payeeId === partnerId);
    expect(paw).toMatchObject({ gstin: null, pan: null, taxableValuePaise: 79900 + 39950 + 79900, tcsPaise: 0, tdsPaise: 5993 + 3995 });
    await http().get(`${API}/admin/finance/tax-report?month=2026-13`).set(bearer(admin)).expect(400);
  });

  it('reconciliation repairs missing postings, finds a capture we never heard about, and recovers it', async () => {
    // A captured payment with no posting (e.g. written before the ledger existed).
    const legacy = await prisma.payment.create({ data: { userId: buyer.id, purpose: 'CONTEST_REGISTRATION', referenceId: buyer.id, amountPaise: 9900, provider: 'fake', providerOrderId: `fake_order_legacy_${Date.now()}`, status: 'CAPTURED', capturedAt: new Date() } });
    // An order the customer paid at the gateway, whose confirmation never reached us.
    await http().put(`${API}/cart/items`).set(bearer(buyer.token)).send({ variantId: jerky, qty: 1 }).expect(200);
    const lost = (await http().post(`${API}/orders`).set(bearer(buyer.token)).send({ addressId: buyer.addressId }).expect(201)).body.data;
    const lostPayment = await prisma.payment.findUniqueOrThrow({ where: { id: lost.payment.paymentId } });
    FakePaymentProvider.checkout(lostPayment.providerOrderId, lostPayment.amountPaise);
    await prisma.payment.update({ where: { id: lostPayment.id }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });

    const run = (await http().post(`${API}/admin/finance/reconciliation/run`).set(bearer(admin)).expect(200)).body.data;
    expect(run.status).toBe('ISSUES');
    expect(run.summary).toMatchObject({ repaired: 1, MISSED_CAPTURE: 1 });
    expect(await posting(`capture:Payment:${legacy.id}`)).toEqual({ GATEWAY_CLEARING: 9900, CUSTOMER_FUNDS: -9900 });
    const open = (await http().get(`${API}/admin/finance/reconciliation/issues`).set(bearer(admin)).expect(200)).body.data;
    expect(open).toEqual([expect.objectContaining({ kind: 'MISSED_CAPTURE', severity: 'ERROR', reference: `Payment:${lostPayment.id}` })]);
    const repaired = (await http().get(`${API}/admin/finance/reconciliation/issues?state=resolved`).set(bearer(admin)).expect(200)).body.data;
    expect(repaired).toEqual([expect.objectContaining({ kind: 'MISSING_POSTING', reference: `Payment:${legacy.id}`, repaired: true })]);

    // Running again doesn't duplicate the open issue.
    expect((await http().post(`${API}/admin/finance/reconciliation/run`).set(bearer(admin)).expect(200)).body.data.summary.newIssues).toBe(0);

    // Recover: the gateway confirms the capture, and the order completes as if the webhook had arrived.
    await http().post(`${API}/admin/finance/payments/${lostPayment.id}/recover`).set(bearer(buyer.token)).expect(403);
    const rec = (await http().post(`${API}/admin/finance/payments/${lostPayment.id}/recover`).set(bearer(admin)).expect(200)).body.data;
    expect(rec.status).toBe('CAPTURED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: lost.order.id } })).status).toBe('PAID');
    expect(await posting(`capture:Payment:${lostPayment.id}`)).toEqual({ GATEWAY_CLEARING: 34800, CUSTOMER_FUNDS: -34800 });
    expect((await http().get(`${API}/admin/finance/reconciliation/issues`).set(bearer(admin)).expect(200)).body.data).toEqual([]);

    // With everything accounted for, a fresh run is clean and the books balance.
    const clean = (await http().post(`${API}/admin/finance/reconciliation/run`).set(bearer(admin)).expect(200)).body.data;
    expect(clean.status).toBe('OK');
    expect(clean.summary.gatewayChecked).toBe(1);
    expect(await trialBalanced()).toBe(true);
    const runs = (await http().get(`${API}/admin/finance/reconciliation/runs`).set(bearer(admin)).expect(200)).body.data;
    expect(runs.map((r: { status: string }) => r.status)).toEqual(['OK', 'ISSUES', 'ISSUES']);
  });

  it('a payment that can’t be honoured (its challenge entry is gone) is refunded in full by the worker', async () => {
    const entryPayment = await prisma.payment.create({ data: { userId: buyer.id, purpose: 'CHALLENGE_JOIN', referenceId: buyer.id, amountPaise: 4900, provider: 'fake', providerOrderId: `fake_order_ch_${Date.now()}`, status: 'CREATED' } });
    await pay(buyer, entryPayment.id); // no challenge behind it: captured, then owed back in full
    const r = await prisma.refund.findUniqueOrThrow({ where: { reference: `Payment:${entryPayment.id}` } });
    expect(r).toMatchObject({ amountPaise: 4900, reason: 'PAYMENT_UNHONOURED' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: entryPayment.id } })).status).toBe('REFUND_PENDING');
    await worker.get(RefundExecutor).sweep();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: entryPayment.id } })).status).toBe('REFUNDED');
    expect(await trialBalanced()).toBe(true);
  });
});
