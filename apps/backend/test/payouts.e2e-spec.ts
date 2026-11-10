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
import { FakePayoutProvider } from '../src/providers/payouts/payout.provider';
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { WorkerModule } from '../src/worker/worker.module';
import { FinanceService } from '../src/modules/finance/finance.service';
import { PayoutsService } from '../src/modules/finance/payouts.service';
import { QueueService } from '../src/queue/queue.service';

const API = '/api/v1';
jest.setTimeout(150_000);
type User = { token: string; id: string };

describe('Payouts, prizes, settlements and invoices (e2e)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  let payouts: PayoutsService;
  const inbox = new Map<string, string>();
  let admin: string; // prepares batches
  let checker: string; // a second finance person approves them
  let seller: User;
  let sellerId: string;
  let jerky: string;
  let buyer: User & { addressId: string };
  let parcelA: string;
  let parcelB: string;
  let stranger: User;

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
  const setting = (key: string, value: unknown) => http().put(`${API}/admin/settings/${key}`).set(bearer(admin)).send({ value }).expect(200);
  const payoutHook = (body: object, eventId: string) => {
    const raw = JSON.stringify(body);
    return http().post(`${API}/webhooks/payouts`).set('Content-Type', 'application/json').set('x-razorpay-event-id', eventId).set('x-razorpay-signature', FakePayoutProvider.signWebhook(raw)).send(raw);
  };
  async function posting(reference: string) {
    const t = await prisma.ledgerTransaction.findUnique({ where: { reference }, include: { entries: { include: { account: true } } } });
    if (!t) return null;
    const net: Record<string, number> = {};
    for (const e of t.entries) net[e.account.code] = (net[e.account.code] ?? 0) + e.debitPaise - e.creditPaise;
    return net;
  }
  async function buy() {
    await http().put(`${API}/cart/items`).set(bearer(buyer.token)).send({ variantId: jerky, qty: 1 }).expect(200);
    const r = (await http().post(`${API}/orders`).set(bearer(buyer.token)).send({ addressId: buyer.addressId }).expect(201)).body.data;
    await pay(buyer, r.payment.paymentId);
    return r.order.parcels[0].id as string;
  }
  async function deliver(id: string) {
    await http().post(`${API}/vendor/orders/${id}/pack`).set(bearer(seller.token)).expect(200);
    await http().post(`${API}/vendor/orders/${id}/ship`).set(bearer(seller.token)).send({ courier: 'Delhivery', trackingNumber: 'DL1234567' }).expect(200);
    await http().post(`${API}/vendor/orders/${id}/deliver`).set(bearer(seller.token)).expect(200);
  }
  async function notification(u: User, type: string, match: RegExp) {
    for (let i = 0; i < 60; i++) {
      const items = (await http().get(`${API}/notifications?limit=50`).set(bearer(u.token)).expect(200)).body.data.items as Array<{ type: string; title: string; body: string }>;
      const n = items.find((x) => x.type === type && match.test(`${x.title} ${x.body}`));
      if (n) return n;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`no ${type} notification matching ${match}`);
  }

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
    payouts = app.get(PayoutsService);
    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    await prisma.featureFlag.createMany({ data: [{ key: 'ENABLE_MARKETPLACE', enabled: true }] });
    const superRole = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    const financeRole = await prisma.role.findUniqueOrThrow({ where: { key: 'FINANCE' } });
    await prisma.user.create({ data: { email: 'root@pay.test', passwordHash: await bcrypt.hash('Root-Password-1', 10), roles: { create: [{ roleId: superRole.id }] } } });
    await prisma.user.create({ data: { email: 'checker@pay.test', passwordHash: await bcrypt.hash('Checker-Password-1', 10), roles: { create: [{ roleId: financeRole.id }] } } });
    admin = (await http().post(`${API}/admin/auth/login`).send({ email: 'root@pay.test', password: 'Root-Password-1' }).expect(200)).body.data.tokens.accessToken;
    checker = (await http().post(`${API}/admin/auth/login`).send({ email: 'checker@pay.test', password: 'Checker-Password-1' }).expect(200)).body.data.tokens.accessToken;

    const treats = (await http().post(`${API}/admin/product-categories`).set(bearer(admin)).send({ key: 'treats', name: 'Treats', commissionBps: 1200 }).expect(201)).body.data.id;
    seller = await login('+919710000001', 'Meera Sharma'); // the proprietor
    sellerId = (await http().post(`${API}/vendor/profile`).set(bearer(seller.token)).send({ businessName: 'Wag & Co', legalName: 'Wag and Co Pvt Ltd', phone: '9710000001', addressLine: '7 Baner Road', city: 'Pune', state: 'Maharashtra', pincode: '411045', gstin: '27ABCDE1234F1Z5', pan: 'ABCDE1234F' }).expect(201)).body.data.id;
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
    const b = await login('+919710000002', 'Ravi Buyer');
    const a = await http().post(`${API}/users/me/addresses`).set(bearer(b.token)).send({ label: 'Home', line1: '21 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' }).expect(201);
    buyer = { ...b, addressId: a.body.data.id };
    stranger = await login('+919710000003', 'Someone Else');

    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(PUSH_PROVIDER).useValue({ name: 'none', send: async () => 'sent' }).compile();
    await worker.init();
    for (const job of ['process-refunds', 'process-payouts']) await app.get(QueueService).maintenance.removeJobScheduler(job);
  });

  beforeEach(async () => {
    await unthrottle();
    FakePayoutProvider.payoutMode = 'processed';
  });
  afterAll(async () => {
    await worker.close();
    await app.close();
  });

  it('a delivered parcel gets the seller’s tax invoice (IGST across states), downloadable by the buyer and the seller only', async () => {
    parcelA = await buy();
    await deliver(parcelA);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { kind_sourceKey: { kind: 'CUSTOMER', sourceKey: `SubOrder:${parcelA}` } } });
    // Seller in Maharashtra, buyer in Karnataka: IGST. ₹299 item (₹45.61 GST) + ₹49 shipping (₹7.47 GST at the item's rate).
    expect(inv).toMatchObject({ title: 'TAX_INVOICE', number: 'WAGI/2627/00001', placeOfSupply: 'Karnataka', totalPaise: 34800, cgstPaise: 0, sgstPaise: 0, igstPaise: 4561 + 747, taxablePaise: 34800 - 5308 });
    expect(inv.issuer).toMatchObject({ name: 'Wag and Co Pvt Ltd', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra' });
    expect(inv.recipient).toMatchObject({ name: 'Ravi Buyer', state: 'Karnataka' });
    const mine = (await http().get(`${API}/me/invoices`).set(bearer(buyer.token)).expect(200)).body.data;
    expect(mine.map((i: { number: string }) => i.number)).toEqual(['WAGI/2627/00001']);
    const file = await http().get(`${API}/invoices/${inv.id}/pdf`).set(bearer(buyer.token)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect((file.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await http().get(`${API}/invoices/${inv.id}/pdf`).set(bearer(seller.token)).expect(200);
    await http().get(`${API}/invoices/${inv.id}/pdf`).set(bearer(stranger.token)).expect(404);
    await http().get(`${API}/admin/finance/invoices/${inv.id}/pdf`).set(bearer(checker)).expect(200);
    // The apps open a short-lived signed link in the phone's browser (no sign-in token there).
    await http().post(`${API}/invoices/${inv.id}/link`).set(bearer(stranger.token)).expect(404);
    const link = (await http().post(`${API}/invoices/${inv.id}/link`).set(bearer(buyer.token)).expect(200)).body.data;
    expect(link).toMatchObject({ path: expect.stringMatching(new RegExp(`^/invoices/${inv.id}/file\\?expires=\\d+&sig=[0-9a-f]{64}$`)), fileName: 'WAGI-2627-00001.pdf' });
    expect(Date.parse(link.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
    const viaLink = await http().get(`${API}${link.path}`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((viaLink.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // Tampered, or used for another invoice: not found.
    await http().get(`${API}${link.path.replace(/sig=./, 'sig=0')}`).expect(404);
    const other = await prisma.invoice.findFirst({ where: { id: { not: inv.id } }, select: { id: true } });
    if (other) await http().get(`${API}${link.path.replace(inv.id, other.id)}`).expect(404);
    await http().get(`${API}/invoices/${inv.id}/file`).expect(404);
    // Issued invoices can't be edited, even by the database owner.
    await expect(prisma.invoice.update({ where: { id: inv.id }, data: { totalPaise: 1 } })).rejects.toThrow(/immutable/);
  });

  it('a received return gets a credit note against the original invoice; numbering has no gaps', async () => {
    parcelB = await buy();
    await deliver(parcelB);
    await http().post(`${API}/sub-orders/${parcelB}/return`).set(bearer(buyer.token)).send({ reason: 'Not needed' }).expect(200);
    const ret = await prisma.returnRequest.findFirstOrThrow({ where: { subOrderId: parcelB } });
    await http().post(`${API}/vendor/returns/${ret.id}/decide`).set(bearer(seller.token)).send({ decision: 'APPROVE' }).expect(200);
    await http().post(`${API}/vendor/returns/${ret.id}/decide`).set(bearer(seller.token)).send({ decision: 'RECEIVED' }).expect(200);
    const original = await prisma.invoice.findUniqueOrThrow({ where: { kind_sourceKey: { kind: 'CUSTOMER', sourceKey: `SubOrder:${parcelB}` } } });
    const cn = await prisma.invoice.findUniqueOrThrow({ where: { kind_sourceKey: { kind: 'CREDIT_NOTE', sourceKey: `Return:${ret.id}` } } });
    expect(original.number).toBe('WAGI/2627/00002');
    expect(cn).toMatchObject({ title: 'CREDIT_NOTE', number: 'WAGC/2627/00001', totalPaise: 29900, igstPaise: 4561, originalInvoiceId: original.id });
    expect(cn.recipient).toMatchObject({ againstInvoice: 'WAGI/2627/00002' });
    const sellerList = (await http().get(`${API}/vendor/invoices`).set(bearer(seller.token)).expect(200)).body.data;
    expect(sellerList.map((i: { number: string }) => i.number).sort()).toEqual(['WAGC/2627/00001', 'WAGI/2627/00001', 'WAGI/2627/00002']);
  });

  it('payout accounts: bank-validated, encrypted at rest, never shown in full', async () => {
    const bad = (await http().post(`${API}/vendor/payout-account`).set(bearer(seller.token)).send({ method: 'BANK', holderName: 'Meera Sharma', ifsc: 'HDFC0001234', accountNumber: '501001230000' }).expect(201)).body.data;
    expect(bad.active).toBeNull();
    expect(bad.pending).toMatchObject({ status: 'FAILED', accountLast4: '0000' });
    await notification(seller, 'PAYOUT_ACCOUNT', /not verified/);
    await http().post(`${API}/vendor/payout-account`).set(bearer(seller.token)).send({ method: 'BANK', holderName: 'Meera', ifsc: 'HDFC1234', accountNumber: '5010012345' }).expect(400);
    const ok = await http().post(`${API}/vendor/payout-account`).set(bearer(seller.token)).send({ method: 'BANK', holderName: 'Meera Sharma', ifsc: 'hdfc0001234', accountNumber: '50100123456789' }).expect(201);
    expect(ok.body.data.active).toMatchObject({ status: 'VERIFIED', ifsc: 'HDFC0001234', accountLast4: '6789', verifiedName: 'MEERA SHARMA', nameMatches: true });
    expect(JSON.stringify(ok.body)).not.toContain('50100123456789');
    const row = await prisma.payoutAccount.findFirstOrThrow({ where: { ownerId: sellerId, status: 'VERIFIED' } });
    expect(row.accountNumberEnc).toMatch(/^v1:/);
    expect(row.accountNumberEnc).not.toContain('50100123456789');
    expect(row.payableFrom!.getTime()).toBeLessThanOrEqual(Date.now()); // first account, in the owner's name: payable at once
    await notification(seller, 'PAYOUT_ACCOUNT', /verified/);
  });

  it('earnings wait out the holding period before they can be paid', async () => {
    const s = (await http().get(`${API}/vendor/payouts`).set(bearer(seller.token)).expect(200)).body.data;
    // ₹310.60 from parcel A, plus the ₹49 shipping the seller keeps from returned parcel B.
    expect(s).toMatchObject({ balancePaise: 35960, availablePaise: 0, holdDays: 7, account: { accountLast4: '6789' } });
    expect((await http().get(`${API}/admin/finance/payouts/preview`).set(bearer(admin)).expect(200)).body.data.count).toBe(0);
    await http().post(`${API}/admin/finance/payout-batches`).set(bearer(admin)).send({}).expect(400);
    await setting('finance.payoutHoldDays', 0);
    const p = (await http().get(`${API}/admin/finance/payouts/preview`).set(bearer(admin)).expect(200)).body.data;
    expect(p.payees).toEqual([expect.objectContaining({ type: 'VENDOR', id: sellerId, amountPaise: 35960 })]);
  });

  it('a batch is prepared by one person, approved by another, sent, and confirmed by the bank', async () => {
    const batch = (await http().post(`${API}/admin/finance/payout-batches`).set(bearer(admin)).send({ note: 'Weekly' }).expect(201)).body.data;
    expect(batch).toMatchObject({ status: 'DRAFT', totals: { count: 1, totalPaise: 35960 } });
    await http().post(`${API}/admin/finance/payout-batches/${batch.id}/approve`).set(bearer(admin)).expect(403); // maker can't check
    const approved = (await http().post(`${API}/admin/finance/payout-batches/${batch.id}/approve`).set(bearer(checker)).expect(200)).body.data;
    expect(approved.status).toBe('PROCESSING');
    // The maker-checker record names both people.
    expect(approved.createdBy?.id).toBe(approved.createdById);
    expect(approved.approvedBy?.id).toBe(approved.approvedById);
    expect(approved.approvedById).not.toBe(approved.createdById);
    const listed = (await http().get(`${API}/admin/finance/payout-batches`).set(bearer(checker)).expect(200)).body.data.find((b: { id: string }) => b.id === batch.id);
    expect(listed.approvedBy?.name).toBeTruthy();
    const payoutId = approved.payouts[0].id;
    expect(await posting(`payout:Payout:${payoutId}`)).toEqual({ [`VENDOR:${sellerId}`]: 35960, PAYOUTS_IN_TRANSIT: -35960 });
    expect((await http().get(`${API}/vendor/payouts`).set(bearer(seller.token)).expect(200)).body.data.balancePaise).toBe(0);
    // The seller's statement keeps what they earned apart from what was paid out.
    const st = (await http().get(`${API}/vendor/statement`).set(bearer(seller.token)).expect(200)).body.data;
    expect(st.totals).toMatchObject({ earnedPaise: 35960, paidOutPaise: 35960 });
    expect(st.items[0]).toMatchObject({ kind: 'PAYOUT_APPROVED', amountPaise: -35960, salePaise: null });
    await http().post(`${API}/admin/finance/payout-batches`).set(bearer(admin)).send({}).expect(400); // nothing left to pay
    await http().post(`${API}/admin/finance/payout-batches/${batch.id}/approve`).set(bearer(checker)).expect(400); // once

    FakePayoutProvider.payoutMode = 'pending';
    expect(await payouts.sweep()).toEqual({ pending: 1 });
    const sent = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(sent).toMatchObject({ status: 'PROCESSING', attempts: 1 });
    // The bank confirms through the provider's webhook.
    const event = { event: 'payout.processed', payload: { payout: { entity: { id: sent.providerPayoutId, status: 'processed', utr: 'HDFCN52026101100001', reference_id: payoutId } } } };
    expect((await payoutHook(event, 'evt_p1').expect(200)).body.data.status).toBe('payout:processed');
    expect((await payoutHook(event, 'evt_p1').expect(200)).body.data.status).toBe('duplicate');
    expect(await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } })).toMatchObject({ status: 'PROCESSED', utr: 'HDFCN52026101100001' });
    expect(await posting(`payout-paid:Payout:${payoutId}`)).toEqual({ PAYOUTS_IN_TRANSIT: 35960, BANK: -35960 });
    expect((await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('COMPLETED');
    expect((await notification(seller, 'PAYOUT_UPDATE', /Payout sent/)).body).toBe('₹359.6 has been paid to ••••6789. Bank reference HDFCN52026101100001.');

    // Days later the bank returns it: the money goes back on the seller's balance, payable at once.
    const reversed = { event: 'payout.reversed', payload: { payout: { entity: { id: sent.providerPayoutId, status: 'reversed', reference_id: payoutId, status_details: { description: 'Beneficiary account closed' } } } } };
    expect((await payoutHook(reversed, 'evt_p2').expect(200)).body.data.status).toBe('payout:reversed');
    expect((await http().get(`${API}/vendor/payouts`).set(bearer(seller.token)).expect(200)).body.data).toMatchObject({ balancePaise: 35960, availablePaise: 35960 });
    await notification(seller, 'PAYOUT_UPDATE', /returned/);
  });

  it('a refused payout goes back on the balance; a cancelled draft reserves nothing', async () => {
    const draft = (await http().post(`${API}/admin/finance/payout-batches`).set(bearer(admin)).send({}).expect(201)).body.data;
    await http().post(`${API}/admin/finance/payout-batches/${draft.id}/cancel`).set(bearer(admin)).expect(200);
    expect(await prisma.payout.count({ where: { batchId: draft.id, status: 'CANCELLED' } })).toBe(1);

    const b = (await http().post(`${API}/admin/finance/payout-batches`).set(bearer(admin)).send({}).expect(201)).body.data;
    await http().post(`${API}/admin/finance/payout-batches/${b.id}/approve`).set(bearer(checker)).expect(200);
    FakePayoutProvider.payoutMode = 'refuse';
    expect(await payouts.sweep()).toEqual({ failed: 1 });
    const p = await prisma.payout.findFirstOrThrow({ where: { batchId: b.id } });
    expect(p).toMatchObject({ status: 'FAILED', failureReason: expect.stringMatching(/insufficient balance/) });
    expect(await posting(`payout-failed:Payout:${p.id}`)).toEqual({ PAYOUTS_IN_TRANSIT: 35960, [`VENDOR:${sellerId}`]: -35960 });
    expect((await http().get(`${API}/vendor/payouts`).set(bearer(seller.token)).expect(200)).body.data.availablePaise).toBe(35960);
  });

  it('outages never fail a payout (it may have gone through); a disabled account or an early reversal sends the money back', async () => {
    // Two batches prepared at once: the database lets only one hold the payee.
    const [x, y] = await Promise.all([1, 2].map(() => http().post(`${API}/admin/finance/payout-batches`).set(bearer(admin)).send({})));
    // Overlapping: the unique index refuses the second (409); otherwise it finds nobody due (400).
    expect([x.status, y.status].filter((st) => st === 201)).toHaveLength(1);
    expect([x.status, y.status].every((st) => [201, 400, 409].includes(st))).toBe(true);
    const b = (x.status === 201 ? x : y).body.data;
    await http().post(`${API}/admin/finance/payout-batches/${b.id}/approve`).set(bearer(checker)).expect(200);
    const id = (await prisma.payout.findFirstOrThrow({ where: { batchId: b.id } })).id;

    FakePayoutProvider.payoutMode = 'outage';
    expect(await payouts.send(id)).toBe('retrying');
    expect(await prisma.payout.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'QUEUED', attempts: 1 });
    await prisma.payout.update({ where: { id }, data: { attempts: 7, nextAttemptAt: new Date(Date.now() - 1000) } });
    expect(await payouts.send(id)).toBe('held'); // out of retries, but never marked failed: the status check decides
    expect(await prisma.payout.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'PROCESSING', lastError: expect.stringMatching(/Needs review/) });

    // The provider did take it; it's being processed, then the bank returns it before we ever saw it paid.
    FakePayoutProvider.payoutMode = 'pending';
    await prisma.payout.update({ where: { id }, data: { status: 'QUEUED', nextAttemptAt: null } });
    expect(await payouts.send(id)).toBe('pending');
    const sent = await prisma.payout.findUniqueOrThrow({ where: { id } });
    FakePayoutProvider.settle(sent.providerPayoutId!, 'reversed', 'Account frozen');
    await prisma.payout.update({ where: { id }, data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
    expect(await payouts.sweep()).toEqual({ reversed: 1 });
    expect(await prisma.payout.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'REVERSED', failureReason: 'Account frozen' });
    expect((await http().get(`${API}/vendor/payouts`).set(bearer(seller.token)).expect(200)).body.data.availablePaise).toBe(35960);

    // Approved, then staff switch the account off before it's sent: nothing goes out.
    const c = (await http().post(`${API}/admin/finance/payout-batches`).set(bearer(admin)).send({}).expect(201)).body.data;
    await http().post(`${API}/admin/finance/payout-batches/${c.id}/approve`).set(bearer(checker)).expect(200);
    const acct = await prisma.payoutAccount.findFirstOrThrow({ where: { ownerId: sellerId, status: 'VERIFIED' } });
    await http().post(`${API}/admin/finance/payout-accounts/${acct.id}/disable`).set(bearer(checker)).send({ reason: 'Reported by the seller as not theirs' }).expect(200);
    FakePayoutProvider.payoutMode = 'processed';
    expect(await payouts.sweep()).toEqual({ failed: 1 });
    expect((await http().get(`${API}/vendor/payouts`).set(bearer(seller.token)).expect(200)).body.data).toMatchObject({ availablePaise: 35960, account: null });
    await notification(seller, 'PAYOUT_ACCOUNT', /switched off/);
  });

  it('an account in a name that isn’t the payee’s is held before its first payout', async () => {
    const r = (await http().post(`${API}/me/payout-account`).set(bearer(stranger.token)).send({ method: 'BANK', holderName: 'Kiran Rao', ifsc: 'ICIC0004321', accountNumber: '000401234567' }).expect(201)).body.data;
    expect(r.active).toMatchObject({ status: 'VERIFIED', verifiedName: 'KIRAN RAO', nameMatches: false });
    expect(Date.parse(r.active.payableFrom)).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it('a UPI ID registered in another of the payee’s names matches, even when the holder name typed differs', async () => {
    // The fake bank registers UPI IDs under the beneficiary's name (here the user's own), not the name typed in.
    const winner = await login('+919710000009', 'Lata Iyer');
    const r = (await http().post(`${API}/me/payout-account`).set(bearer(winner.token)).send({ method: 'UPI', holderName: 'L Iyer', vpa: 'lata@okicici' }).expect(201)).body.data;
    expect(r.active).toMatchObject({ verifiedName: 'LATA IYER', nameMatches: true });
    expect(Date.parse(r.active.payableFrom)).toBeLessThanOrEqual(Date.now()); // no safety hold
    const listed = (await http().get(`${API}/admin/finance/payout-accounts?ownerType=USER`).set(bearer(admin)).expect(200)).body.data;
    expect(listed.find((a: { id: string }) => a.id === r.active.id)).toMatchObject({ nameMatches: true, ownerName: 'Lata Iyer' });
  });

  it('a new bank account replaces the old one only once verified, and is paid only after a safety hold', async () => {
    await http().post(`${API}/vendor/payout-account`).set(bearer(seller.token)).send({ method: 'UPI', holderName: 'Meera Sharma', vpa: 'meera@okhdfcbank' }).expect(201);
    const accounts = await prisma.payoutAccount.findMany({ where: { ownerId: sellerId }, orderBy: { createdAt: 'asc' } });
    expect(accounts.map((a) => a.status)).toEqual(['FAILED', 'DISABLED', 'VERIFIED']);
    // Held even though the old one was switched off: it isn't the first account this seller has had verified.
    expect(accounts[2].payableFrom!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect((await http().get(`${API}/admin/finance/payouts/preview`).set(bearer(admin)).expect(200)).body.data.count).toBe(0); // held
    await http().post(`${API}/vendor/payout-account`).set(bearer(seller.token)).send({ method: 'UPI', holderName: 'Meera Sharma', vpa: 'meera@okicici' }).expect(400); // 3 changes today
    await prisma.payoutAccount.update({ where: { id: accounts[2].id }, data: { payableFrom: new Date(Date.now() - 1000) } });
    expect((await http().get(`${API}/admin/finance/payouts/preview`).set(bearer(admin)).expect(200)).body.data.count).toBe(1);
  });

  it('contests: entry fees become revenue when completed; a cash prize is approved with TDS and paid to the winner', async () => {
    const species = await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } });
    const pet = await prisma.pet.create({ data: { ownerId: buyer.id, speciesId: species.id, name: 'Bruno', handle: `bruno${Date.now()}` } });
    const contest = await prisma.contest.create({ data: { slug: `best-${Date.now()}`, title: 'Best Groomed Pet', description: 'A contest.', status: 'LIVE', feePaise: 9900, registrationOpensAt: hours(-48), registrationClosesAt: hours(24), submissionClosesAt: hours(48), votingClosesAt: hours(72), createdById: buyer.id } });
    const payment = await prisma.payment.create({ data: { userId: buyer.id, purpose: 'CONTEST_REGISTRATION', referenceId: contest.id, amountPaise: 9900, provider: 'fake', providerOrderId: `fake_order_c_${Date.now()}` } });
    const entry = await prisma.contestParticipant.create({ data: { contestId: contest.id, userId: buyer.id, petId: pet.id, paymentId: payment.id } });
    await pay(buyer, payment.id);
    expect((await prisma.contestParticipant.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('REGISTERED');
    await prisma.contest.update({ where: { id: contest.id }, data: { status: 'COMPLETED' } });
    await prisma.$transaction((tx) => app.get(FinanceService).entryFeesEarned(tx, 'CONTEST_REGISTRATION', contest.id, contest.title));
    // ₹99 entry fee with 18% GST inside: ₹83.90 revenue, ₹15.10 GST.
    expect(await posting(`entry-fees:Contest:${contest.id}`)).toEqual({ CUSTOMER_FUNDS: 9900, ENTRY_FEE_REVENUE: -8390, GST_PAYABLE: -1510 });

    const prize = await prisma.contestPrize.create({ data: { contestId: contest.id, rank: 1, title: '1st prize', kind: 'CASH', amountPaise: 15_000_00, participantId: entry.id, payoutStatus: 'PENDING' } });
    const pending = (await http().get(`${API}/admin/finance/prizes`).set(bearer(checker)).expect(200)).body.data;
    expect(pending).toEqual([expect.objectContaining({ id: prize.id, amountPaise: 15_000_00, winnerHasPayoutAccount: false, winner: expect.objectContaining({ name: 'Ravi Buyer', petName: 'Bruno' }) })]);
    const approved = (await http().post(`${API}/admin/finance/prizes/${prize.id}/approve`).set(bearer(checker)).expect(200)).body.data;
    expect(approved).toMatchObject({ grossPaise: 15_000_00, tdsPaise: 4_500_00, netPaise: 10_500_00 });
    await http().post(`${API}/admin/finance/prizes/${prize.id}/approve`).set(bearer(checker)).expect(400);
    expect(await posting(`prize:ContestPrize:${prize.id}`)).toEqual({ PRIZE_EXPENSE: 15_000_00, TDS_PAYABLE: -4_500_00, [`USER:${buyer.id}`]: -10_500_00 });

    // The winner adds a UPI ID; prize money has no holding period.
    await http().post(`${API}/me/payout-account`).set(bearer(buyer.token)).send({ method: 'UPI', holderName: 'Ravi Buyer', vpa: 'ravi@okaxis' }).expect(201);
    expect((await http().get(`${API}/me/payouts`).set(bearer(buyer.token)).expect(200)).body.data).toMatchObject({ balancePaise: 10_500_00, availablePaise: 10_500_00 });
    const batch = (await http().post(`${API}/admin/finance/payout-batches`).set(bearer(checker)).send({ payeeType: 'USER' }).expect(201)).body.data;
    expect(batch.payouts).toEqual([expect.objectContaining({ payeeType: 'USER', payeeId: buyer.id, amountPaise: 10_500_00, purpose: 'PRIZE' })]);
    await http().post(`${API}/admin/finance/payout-batches/${batch.id}/approve`).set(bearer(admin)).expect(200);
    expect(await payouts.sweep()).toEqual({ processed: 1 });
    expect((await prisma.contestPrize.findUniqueOrThrow({ where: { id: prize.id } })).payoutStatus).toBe('PAID');
    await notification(buyer, 'PAYOUT_UPDATE', /₹10,500 has been paid to ravi@okaxis/);
  });

  it('gateway settlements move money to the bank, net of fees; the books still reconcile', async () => {
    FakePaymentProvider.settlements.push({ settlementId: `setl_${Date.now()}`, amountPaise: 50_000, feesPaise: 1_180, taxPaise: 180, utr: 'SETLUTR1', settledAt: new Date(Date.now() - 3_600_000) });
    expect((await http().post(`${API}/admin/finance/settlements/sync`).set(bearer(admin)).expect(200)).body.data).toEqual({ added: 1 });
    expect((await http().post(`${API}/admin/finance/settlements/sync`).set(bearer(admin)).expect(200)).body.data).toEqual({ added: 0 });
    const s = (await http().get(`${API}/admin/finance/settlements`).set(bearer(admin)).expect(200)).body.data[0];
    expect(await posting(`settlement:fake:${s.providerSettlementId}`)).toEqual({ BANK: 50_000, GATEWAY_FEES: 1_000, GST_INPUT_CREDIT: 180, GATEWAY_CLEARING: -51_180 });
    const run = (await http().post(`${API}/admin/finance/reconciliation/run`).set(bearer(admin)).expect(200)).body.data;
    expect(run.status).toBe('OK');
    expect((await http().get(`${API}/admin/finance/trial-balance`).set(bearer(admin)).expect(200)).body.data.totals.balanced).toBe(true);
  });

  it('PetApp’s monthly commission invoices: only for a finished month, with company details set', async () => {
    // A parcel delivered last month (its posting is made by reconciliation, dated when it was delivered).
    const last = await buy();
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15, 6));
    await prisma.subOrder.update({ where: { id: last }, data: { status: 'DELIVERED', packedAt: lastMonth, shippedAt: lastMonth, deliveredAt: lastMonth } });
    await http().post(`${API}/admin/finance/reconciliation/run`).set(bearer(admin)).expect(200);
    const month = new Date(lastMonth.getTime() + 330 * 60_000).toISOString().slice(0, 7);
    const thisMonth = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    await http().post(`${API}/admin/finance/invoices/commission`).set(bearer(admin)).send({ month: thisMonth }).expect(400); // not over yet
    expect((await http().post(`${API}/admin/finance/invoices/commission`).set(bearer(admin)).send({ month }).expect(400)).body.message).toMatch(/company name, GSTIN and address/);
    await setting('company.legalName', 'PetApp Technologies Pvt Ltd');
    await setting('company.gstin', '27AAACP1234Q1Z9');
    await setting('company.address', '1 Tech Park, Pune 411057');
    const run = (await http().post(`${API}/admin/finance/invoices/commission`).set(bearer(admin)).send({ month }).expect(200)).body.data;
    expect(run.issued).toEqual([expect.objectContaining({ payeeKey: `VENDOR:${sellerId}`, totalPaise: 3588 })]);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: run.issued[0].id } });
    // Both in Maharashtra: CGST + SGST on the ₹30.41 commission.
    expect(inv).toMatchObject({ kind: 'COMMISSION', taxablePaise: 3041, cgstPaise: 273, sgstPaise: 274, igstPaise: 0, placeOfSupply: 'Maharashtra' });
    expect(inv.number).toMatch(/^PA\/\d{4}\/00001$/);
    expect((await http().post(`${API}/admin/finance/invoices/commission`).set(bearer(admin)).send({ month }).expect(200)).body.data.issued[0].id).toBe(inv.id); // idempotent
    const forSeller = (await http().get(`${API}/vendor/invoices?kind=COMMISSION`).set(bearer(seller.token)).expect(200)).body.data;
    expect(forSeller.map((i: { id: string }) => i.id)).toEqual([inv.id]);
    await http().get(`${API}/invoices/${inv.id}/pdf`).set(bearer(seller.token)).expect(200);
    await http().get(`${API}/invoices/${inv.id}/pdf`).set(bearer(buyer.token)).expect(404);
  });
});
