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
import { syncRbac } from '../src/modules/rbac/rbac.seed';
import { WorkerModule } from '../src/worker/worker.module';
import { quote } from '../src/modules/marketplace/marketplace.rules';

const API = '/api/v1';
jest.setTimeout(150_000);
type User = { token: string; id: string };

describe('Product marketplace (e2e)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;
  const inbox = new Map<string, string>();
  let admin: string;
  let food: string;
  let dogFood: string;
  let toys: string;
  let vendorA: User;
  let vendorB: User;
  let vendorAId: string;
  let vendorBId: string;
  let kibble3: string; // ₹1,699, stock 5
  let kibble7: string; // ₹3,499, stock 2
  let toy: string; // ₹199, stock 10
  let kibbleProduct: string;

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

  const media = (ownerId: string, kind: 'IMAGE' | 'DOCUMENT') =>
    prisma.mediaAsset.create({ data: { ownerId, kind, mimeType: kind === 'IMAGE' ? 'image/jpeg' : 'application/pdf', sizeBytes: 1000, storageKey: `uploads/${ownerId}/${Math.random()}`, status: 'READY', variants: {} } });

  async function customer(phone: string, name: string) {
    const u = await login(phone, name);
    const a = await http().post(`${API}/users/me/addresses`).set(bearer(u.token)).send({ label: 'Home', line1: '4 Lake View', city: 'Pune', state: 'Maharashtra', pincode: '411001' }).expect(201);
    return { ...u, addressId: a.body.data.id as string };
  }

  /** Waits for a notification of this type (and title, if given): earlier ones of the same type don't count. */
  async function notified(u: User, type: string, title?: string) {
    for (let i = 0; i < 60; i++) {
      const items = (await http().get(`${API}/notifications?limit=50`).set(bearer(u.token)).expect(200)).body.data.items as Array<{ type: string; title: string; body: string }>;
      const hit = items.find((n) => n.type === type && (title === undefined || n.title === title));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`no ${type} notification`);
  }

  async function approvedVendor(phone: string, name: string, gstin?: string): Promise<{ u: User; id: string }> {
    const u = await login(phone, name);
    const p = await http().post(`${API}/vendor/profile`).set(bearer(u.token)).send({ businessName: name, phone: phone.slice(3), addressLine: '1 Market Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', gstin }).expect(201);
    const id = p.body.data.id as string;
    const kinds = gstin ? ['ID_PROOF', 'GST_CERTIFICATE'] : ['ID_PROOF'];
    for (const kind of kinds) await http().post(`${API}/vendor/documents`).set(bearer(u.token)).send({ kind, mediaId: (await media(u.id, 'DOCUMENT')).id }).expect(201);
    await http().post(`${API}/vendor/submit`).set(bearer(u.token)).expect(200);
    const docs = (await http().get(`${API}/admin/vendors/${id}`).set(bearer(admin)).expect(200)).body.data.documents as Array<{ id: string }>;
    await http().post(`${API}/admin/vendors/${id}/review`).set(bearer(admin)).send({ decision: 'APPROVE', documents: docs.map((d) => ({ id: d.id, status: 'ACCEPTED' })) }).expect(200);
    return { u, id };
  }

  function place(c: User & { addressId: string }, couponCode?: string) {
    return http().post(`${API}/orders`).set(bearer(c.token)).send({ addressId: c.addressId, couponCode });
  }

  async function pay(c: User, paymentId: string) {
    await http().post(`${API}/payments/${paymentId}/simulate`).set(bearer(c.token)).expect(200);
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
    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND tablename <> 'spatial_ref_sys'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    await prisma.featureFlag.create({ data: { key: 'ENABLE_MARKETPLACE', enabled: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    await prisma.user.create({ data: { email: 'root@shop.test', passwordHash: await bcrypt.hash('Root-Password-1', 10), roles: { create: [{ roleId: role.id }] } } });
    admin = (await http().post(`${API}/admin/auth/login`).send({ email: 'root@shop.test', password: 'Root-Password-1' }).expect(200)).body.data.tokens.accessToken;
    food = (await http().post(`${API}/admin/product-categories`).set(bearer(admin)).send({ key: 'food', name: 'Food', commissionBps: 1000 }).expect(201)).body.data.id;
    dogFood = (await http().post(`${API}/admin/product-categories`).set(bearer(admin)).send({ key: 'dog-food', name: 'Dog food', parentId: food, commissionBps: 1000 }).expect(201)).body.data.id;
    toys = (await http().post(`${API}/admin/product-categories`).set(bearer(admin)).send({ key: 'toys', name: 'Toys', commissionBps: 1500 }).expect(201)).body.data.id;
    await http().post(`${API}/admin/product-categories`).set(bearer(admin)).send({ key: 'too-deep', name: 'Too deep', parentId: dogFood, commissionBps: 1000 }).expect(400);
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(PUSH_PROVIDER).useValue({ name: 'none', send: async () => 'sent' }).compile();
    await worker.init();
  });

  beforeEach(unthrottle);
  afterAll(async () => {
    await worker.close();
    await app.close();
  });

  it('onboards vendors: documents (GST certificate when a GSTIN is given), review and approval', async () => {
    const u = await login('+919811100001', 'Happy Tails');
    const p = await http().post(`${API}/vendor/profile`).set(bearer(u.token)).send({ businessName: 'Happy Tails', phone: '9811100001', addressLine: '1 Market Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', gstin: '27abcde1234f1z5' }).expect(201);
    expect(p.body.data).toMatchObject({ status: 'DRAFT', gstin: '27ABCDE1234F1Z5', checklist: ['Upload an ID proof.', 'Upload your GST certificate.'] });
    await http().post(`${API}/vendor/products`).set(bearer(u.token)).send({ categoryId: dogFood, title: 'Too early', description: 'Not approved yet.', variants: [] }).expect(400);
    const id1 = (await media(u.id, 'DOCUMENT')).id;
    const withId = await http().post(`${API}/vendor/documents`).set(bearer(u.token)).send({ kind: 'ID_PROOF', mediaId: id1 }).expect(201);
    expect(withId.body.data.documents[0].url).toMatch(/X-Amz-Signature/); // private, short-lived
    const early = await http().post(`${API}/vendor/submit`).set(bearer(u.token)).expect(400);
    expect(early.body.errors.map((e: { message: string }) => e.message)).toEqual(['Upload your GST certificate.']);
    await http().post(`${API}/vendor/documents`).set(bearer(u.token)).send({ kind: 'GST_CERTIFICATE', mediaId: (await media(u.id, 'DOCUMENT')).id }).expect(201);
    await http().post(`${API}/vendor/submit`).set(bearer(u.token)).expect(200);

    const queue = await http().get(`${API}/admin/vendors?status=SUBMITTED`).set(bearer(admin)).expect(200);
    expect(queue.body.data.map((v: { businessName: string }) => v.businessName)).toEqual(['Happy Tails']);
    const docs = (await http().get(`${API}/admin/vendors/${p.body.data.id}`).set(bearer(admin)).expect(200)).body.data.documents as Array<{ id: string; kind: string }>;
    const idDoc = docs.find((d) => d.kind === 'ID_PROOF')!.id;
    const gstDoc = docs.find((d) => d.kind === 'GST_CERTIFICATE')!.id;
    const refused = await http().post(`${API}/admin/vendors/${p.body.data.id}/review`).set(bearer(admin)).send({ decision: 'APPROVE', documents: [{ id: idDoc, status: 'ACCEPTED' }] }).expect(400);
    expect(refused.body.message).toMatch(/GST certificate/);
    await http().post(`${API}/admin/vendors/${p.body.data.id}/review`).set(bearer(admin)).send({ decision: 'APPROVE', documents: [{ id: idDoc, status: 'ACCEPTED' }, { id: gstDoc, status: 'ACCEPTED' }] }).expect(200);
    const roles = await prisma.userRole.findMany({ where: { userId: u.id }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toContain('PRODUCT_PARTNER');
    expect((await notified(u, 'VENDOR_STATUS')).title).toBe('Your store is approved!');
    vendorA = u;
    vendorAId = p.body.data.id;
    ({ u: vendorB, id: vendorBId } = await approvedVendor('+919811100002', 'Chew Co'));
  });

  it('lists products: variants, images before going live, honest prices, and category trees', async () => {
    const bad = await http().post(`${API}/vendor/products`).set(bearer(vendorA.token)).send({ categoryId: dogFood, title: 'Kibble', description: 'Adult dog food.', variants: [{ sku: 'K-3', title: '3 kg', mrpPaise: 150000, pricePaise: 169900, gstRateBps: 1800, stock: 5 }] }).expect(400);
    expect(bad.body.message).toMatch(/can’t be above the MRP/);
    await http().post(`${API}/vendor/products`).set(bearer(vendorA.token)).send({ categoryId: dogFood, title: 'Kibble', description: 'Adult dog food.', variants: [{ sku: 'K-3', title: '3 kg', mrpPaise: 189900, pricePaise: 169900, gstRateBps: 1800, stock: 5 }, { sku: 'k-3', title: 'dupe', mrpPaise: 100, pricePaise: 100, gstRateBps: 0, stock: 1 }] }).expect(400);
    const p = await http()
      .post(`${API}/vendor/products`)
      .set(bearer(vendorA.token))
      .send({ categoryId: dogFood, title: 'Royal Kibble Adult', brand: 'Royal', description: 'Complete food for adult dogs.', variants: [{ sku: 'RK-3', title: '3 kg', mrpPaise: 189900, pricePaise: 169900, gstRateBps: 1800, stock: 5 }, { sku: 'RK-7', title: '7 kg', mrpPaise: 389900, pricePaise: 349900, gstRateBps: 1800, stock: 2 }] })
      .expect(201);
    kibbleProduct = p.body.data.id;
    [kibble3, kibble7] = ['RK-3', 'RK-7'].map((sku) => p.body.data.variants.find((v: { sku: string }) => v.sku === sku).id);
    expect((await http().patch(`${API}/vendor/products/${kibbleProduct}`).set(bearer(vendorA.token)).send({ status: 'ACTIVE' }).expect(400)).body.message).toMatch(/at least one photo/);
    const img = await media(vendorA.id, 'IMAGE');
    await http().patch(`${API}/vendor/products/${kibbleProduct}`).set(bearer(vendorA.token)).send({ imageIds: [(await media(vendorB.id, 'IMAGE')).id] }).expect(400); // not theirs
    await http().patch(`${API}/vendor/products/${kibbleProduct}`).set(bearer(vendorA.token)).send({ imageIds: [img.id], status: 'ACTIVE' }).expect(200);
    await http().patch(`${API}/vendor/products/${kibbleProduct}`).set(bearer(vendorB.token)).send({ status: 'INACTIVE' }).expect(404); // not B's

    const t = await http().post(`${API}/vendor/products`).set(bearer(vendorB.token)).send({ categoryId: toys, title: 'Squeaky Bone', description: 'Durable rubber toy.', imageIds: [(await media(vendorB.id, 'IMAGE')).id], variants: [{ sku: 'SB-1', title: 'Medium', mrpPaise: 24900, pricePaise: 19900, gstRateBps: 1200, stock: 10 }] }).expect(201);
    toy = t.body.data.variants[0].id;
    // Product photos go through the normal upload endpoint even with Reels switched off; videos still need Reels.
    expect(await prisma.featureFlag.findUnique({ where: { key: 'ENABLE_REELS' } })).toBeNull();
    await http().post(`${API}/media/uploads`).set(bearer(vendorB.token)).send({ kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 50_000 }).expect(201);
    await http().post(`${API}/media/uploads`).set(bearer(vendorB.token)).send({ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 50_000 }).expect(404);
    await http().patch(`${API}/vendor/products/${t.body.data.id}`).set(bearer(vendorB.token)).send({ status: 'ACTIVE' }).expect(200);

    const all = (await http().get(`${API}/products`).expect(200)).body.data;
    expect(all.map((x: { title: string }) => x.title).sort()).toEqual(['Royal Kibble Adult', 'Squeaky Bone']);
    expect((await http().get(`${API}/products?categoryId=${food}`).expect(200)).body.data.map((x: { title: string }) => x.title)).toEqual(['Royal Kibble Adult']); // parent includes child
    expect((await http().get(`${API}/products?q=squeak`).expect(200)).body.data).toHaveLength(1);
    expect((await http().get(`${API}/products?sort=price_asc`).expect(200)).body.data.map((x: { fromPaise: number }) => x.fromPaise)).toEqual([19900, 169900]);
    const detail = (await http().get(`${API}/products/${kibbleProduct}`).expect(200)).body.data;
    expect(detail.variants.map((v: { title: string; lowStock: number | null }) => [v.title, v.lowStock])).toEqual([['3 kg', 5], ['7 kg', 2]]);
  });

  it('checks out: prices from the rules, a platform coupon, a parcel per vendor, stock reserved, payment confirms', async () => {
    const c = await customer('+919822200001', 'Asha Buyer');
    await http().put(`${API}/cart/items`).set(bearer(c.token)).send({ variantId: kibble3, qty: 6 }).expect(400); // only 5
    await http().put(`${API}/cart/items`).set(bearer(c.token)).send({ variantId: kibble3, qty: 2 }).expect(200);
    await http().put(`${API}/cart/items`).set(bearer(c.token)).send({ variantId: toy, qty: 1 }).expect(200);
    await http().post(`${API}/admin/coupons`).set(bearer(admin)).send({ code: 'pets10', kind: 'PERCENT', value: 1000, maxDiscountPaise: 10000, startsAt: hours(-1), endsAt: hours(48) }).expect(201);
    await http().post(`${API}/admin/coupons`).set(bearer(admin)).send({ code: 'PETS10', kind: 'FLAT', value: 1, startsAt: hours(-1), endsAt: hours(1) }).expect(409);

    expect((await http().post(`${API}/checkout/preview`).set(bearer(c.token)).send({ couponCode: 'NOPE' }).expect(200)).body.data.couponProblem).toBe('That coupon code isn’t valid.');
    const preview = (await http().post(`${API}/checkout/preview`).set(bearer(c.token)).send({ couponCode: 'pets10' }).expect(200)).body.data;
    const expected = quote(
      [
        { variantId: kibble3, vendorId: vendorAId, qty: 2, unitPricePaise: 169900, gstRateBps: 1800, commissionBps: 1000 },
        { variantId: toy, vendorId: vendorBId, qty: 1, unitPricePaise: 19900, gstRateBps: 1200, commissionBps: 1500 },
      ],
      { code: 'PETS10', kind: 'PERCENT', value: 1000, maxDiscountPaise: 10000, minOrderPaise: 0, vendorId: null },
      { flatPaise: 4900, freeAbovePaise: 49900 },
    );
    expect(preview).toMatchObject({ itemsPaise: 359700, discountPaise: 10000, shippingPaise: expected.shippingPaise, totalPaise: expected.totalPaise, coupon: { code: 'PETS10', fundedBy: 'PLATFORM' }, canCheckout: true });

    const r = (await place(c, 'pets10').expect(201)).body.data;
    expect(r.order.parcels).toHaveLength(2);
    expect(r.payment).toMatchObject({ amountPaise: expected.totalPaise, status: 'CREATED' });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: kibble3 } })).stock).toBe(3); // reserved
    expect((await http().get(`${API}/cart`).set(bearer(c.token)).expect(200)).body.data.items).toHaveLength(0);
    const subs = await prisma.subOrder.findMany({ where: { orderId: r.order.id }, include: { items: true } });
    for (const v of expected.vendors) {
      const s = subs.find((x) => x.vendorId === v.vendorId)!;
      expect(s).toMatchObject({ itemsPaise: v.itemsPaise, discountPaise: v.discountPaise, shippingPaise: v.shippingPaise, totalPaise: v.totalPaise, commissionPaise: v.commissionPaise, vendorEarningPaise: v.vendorEarningPaise });
    }
    expect(subs.find((s) => s.vendorId === vendorAId)!.items[0].gstPaise).toBe(expected.vendors.find((v) => v.vendorId === vendorAId)!.lines[0].gstPaise);

    await pay(c, r.payment.paymentId);
    const after = (await http().get(`${API}/orders/${r.order.id}`).set(bearer(c.token)).expect(200)).body.data;
    expect(after.status).toBe('PAID');
    expect(after.parcels.map((p: { status: string }) => p.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    expect((await notified(c, 'ORDER_CONFIRMED')).body).toMatch(/will arrive in 2 parcels/);
    expect((await notified(vendorA, 'VENDOR_NEW_ORDER')).title).toBe('New order');
    expect((await place(c, 'pets10').expect(400)).body.message).toBe('Your cart is empty.');
    await http().put(`${API}/cart/items`).set(bearer(c.token)).send({ variantId: toy, qty: 1 }).expect(200);
    expect((await http().post(`${API}/checkout/preview`).set(bearer(c.token)).send({ couponCode: 'PETS10' }).expect(200)).body.data.couponProblem).toBe('You’ve already used this coupon.');
    await http().delete(`${API}/cart`).set(bearer(c.token)).expect(200);
  });

  it('three buyers race for the last two units: exactly one order succeeds, stock never goes negative', async () => {
    const buyers = await Promise.all(['+919822200011', '+919822200012', '+919822200013'].map((p, i) => customer(p, `Racer ${i}`)));
    for (const b of buyers) await http().put(`${API}/cart/items`).set(bearer(b.token)).send({ variantId: kibble7, qty: 2 }).expect(200);
    const results = await Promise.all(buyers.map((b) => place(b).then((r) => r.status)));
    // Exactly one winner. A loser whose request overlapped the winner's is stopped by the conditional
    // stock decrement (409 "just sold out"); one that arrives after the winner committed is stopped by
    // the cart check up front (400, the cart shows "Out of stock"). Both are clean refusals; never a 5xx.
    expect(results.filter((s) => s === 201)).toHaveLength(1);
    expect(results.filter((s) => s !== 201).every((s) => s === 400 || s === 409)).toBe(true);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: kibble7 } })).stock).toBe(0);
    expect(await prisma.order.count({ where: { userId: { in: buyers.map((b) => b.id) } } })).toBe(1);
  });

  it('fulfils in order with tracking; cancellations refund the parcel and restock; the order completes', async () => {
    const c = await customer('+919822200021', 'Bilal Buyer');
    await http().put(`${API}/cart/items`).set(bearer(c.token)).send({ variantId: kibble3, qty: 1 }).expect(200);
    await http().put(`${API}/cart/items`).set(bearer(c.token)).send({ variantId: toy, qty: 2 }).expect(200);
    const r = (await place(c).expect(201)).body.data;
    await pay(c, r.payment.paymentId);
    const subs = await prisma.subOrder.findMany({ where: { orderId: r.order.id } });
    const [a, b] = [vendorAId, vendorBId].map((v) => subs.find((s) => s.vendorId === v)!);

    // The seller sees who to send it to: the buyer's name and phone with the address, not the address's label.
    const toPack = (await http().get(`${API}/vendor/orders?status=CONFIRMED`).set(bearer(vendorA.token)).expect(200)).body.data.find((o: { id: string }) => o.id === a.id);
    expect(toPack.shipTo).toMatchObject({ name: 'Bilal Buyer', phone: '+919822200021', label: 'Home', line1: '4 Lake View', pincode: '411001' });
    expect(toPack.orderCode).toBe(r.order.code);
    await http().post(`${API}/vendor/orders/${a.id}/pack`).set(bearer(vendorB.token)).expect(404); // not B's
    await http().post(`${API}/vendor/orders/${a.id}/ship`).set(bearer(vendorA.token)).send({ courier: 'Delhivery', trackingNumber: 'DL123456' }).expect(400); // pack first
    await http().post(`${API}/vendor/orders/${a.id}/pack`).set(bearer(vendorA.token)).expect(200);
    expect((await http().post(`${API}/sub-orders/${a.id}/cancel`).set(bearer(c.token)).send({ reason: 'Changed my mind' }).expect(400)).body.message).toMatch(/already packed/);
    await http().post(`${API}/vendor/orders/${a.id}/ship`).set(bearer(vendorA.token)).send({ courier: 'Delhivery', trackingNumber: 'DL123456' }).expect(200);
    expect((await notified(c, 'ORDER_UPDATE', 'Shipped')).body).toMatch(/on its way with Delhivery \(tracking DL123456\)/);
    await http().post(`${API}/vendor/orders/${a.id}/cancel`).set(bearer(vendorA.token)).send({ reason: 'Too late' }).expect(400); // already shipped
    await http().post(`${API}/vendor/orders/${a.id}/deliver`).set(bearer(vendorA.token)).expect(200);

    const toyStock = (await prisma.productVariant.findUniqueOrThrow({ where: { id: toy } })).stock;
    await http().post(`${API}/sub-orders/${b.id}/cancel`).set(bearer(c.token)).send({ reason: 'Found it cheaper' }).expect(200);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: toy } })).stock).toBe(toyStock + 2);
    expect(await prisma.refund.findUniqueOrThrow({ where: { reference: `SubOrder:${b.id}` } })).toMatchObject({ amountPaise: b.totalPaise, reason: 'SUB_ORDER_CANCELLED', status: 'PENDING' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } })).status).toBe('COMPLETED');
    expect((await notified(vendorB, 'ORDER_UPDATE', 'Order cancelled')).body).toMatch(/Don’t ship it/);

    const e = (await http().get(`${API}/vendor/earnings`).set(bearer(vendorA.token)).expect(200)).body.data;
    const delivered = await prisma.subOrder.findMany({ where: { vendorId: vendorAId, status: 'DELIVERED' } });
    expect(e.delivered).toEqual({ orders: delivered.length, salesPaise: delivered.reduce((x, s) => x + s.totalPaise, 0), commissionPaise: delivered.reduce((x, s) => x + s.commissionPaise, 0), earnedPaise: delivered.reduce((x, s) => x + s.vendorEarningPaise, 0) });
  });

  it('returns: inside the window, decided by the vendor, refunded on receipt; closed after the window', async () => {
    const c = await customer('+919822200031', 'Chitra Buyer');
    await http().put(`${API}/cart/items`).set(bearer(c.token)).send({ variantId: toy, qty: 3 }).expect(200);
    const r = (await place(c).expect(201)).body.data;
    await pay(c, r.payment.paymentId);
    const s = await prisma.subOrder.findFirstOrThrow({ where: { orderId: r.order.id } });
    await http().post(`${API}/sub-orders/${s.id}/return`).set(bearer(c.token)).send({ reason: 'Wrong size' }).expect(400); // not delivered
    for (const step of ['pack', 'ship', 'deliver']) await http().post(`${API}/vendor/orders/${s.id}/${step}`).set(bearer(vendorB.token)).send({ courier: 'Blue Dart', trackingNumber: 'BD99887766' }).expect(200);

    const ordered = (await http().get(`${API}/orders/${r.order.id}`).set(bearer(c.token)).expect(200)).body.data;
    expect(ordered.parcels[0]).toMatchObject({ canReturn: true, canCancel: false });
    await http().post(`${API}/sub-orders/${s.id}/return`).set(bearer(c.token)).send({ reason: 'Our dog ignores it' }).expect(200);
    expect((await notified(vendorB, 'ORDER_UPDATE', 'Return requested')).body).toMatch(/asked to return/);
    const ret = await prisma.returnRequest.findFirstOrThrow({ where: { subOrderId: s.id } });
    expect(ret.refundPaise).toBe(s.itemsPaise - s.discountPaise); // shipping isn't refunded
    await http().post(`${API}/vendor/returns/${ret.id}/decide`).set(bearer(vendorB.token)).send({ decision: 'REJECT' }).expect(400); // reason needed
    await http().post(`${API}/vendor/returns/${ret.id}/decide`).set(bearer(vendorB.token)).send({ decision: 'RECEIVED' }).expect(400); // approve first
    await http().post(`${API}/vendor/returns/${ret.id}/decide`).set(bearer(vendorB.token)).send({ decision: 'APPROVE' }).expect(200);
    const stock = (await prisma.productVariant.findUniqueOrThrow({ where: { id: toy } })).stock;
    await http().post(`${API}/vendor/returns/${ret.id}/decide`).set(bearer(vendorB.token)).send({ decision: 'RECEIVED', note: 'Unused, in box' }).expect(200);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: toy } })).stock).toBe(stock + 3);
    expect(await prisma.refund.findUniqueOrThrow({ where: { reference: `Return:${ret.id}` } })).toMatchObject({ amountPaise: ret.refundPaise, reason: 'RETURN' });
    expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('RETURNED');

    // A delivery 8 days ago is outside the 7-day window.
    const c2 = await customer('+919822200032', 'Late Returner');
    await http().put(`${API}/cart/items`).set(bearer(c2.token)).send({ variantId: toy, qty: 1 }).expect(200);
    const r2 = (await place(c2).expect(201)).body.data;
    await pay(c2, r2.payment.paymentId);
    const s2 = await prisma.subOrder.findFirstOrThrow({ where: { orderId: r2.order.id } });
    await prisma.subOrder.update({ where: { id: s2.id }, data: { status: 'DELIVERED', deliveredAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect((await http().post(`${API}/sub-orders/${s2.id}/return`).set(bearer(c2.token)).send({ reason: 'Too late?' }).expect(400)).body.message).toBe('Returns close 7 days after delivery.');
  });

  it('unpaid orders release stock and coupon uses; a late payment revives the order if it can, else it is refunded', async () => {
    await http().post(`${API}/admin/coupons`).set(bearer(admin)).send({ code: 'ONCE', kind: 'FLAT', value: 1000, startsAt: hours(-1), endsAt: hours(48), usageLimit: 5 }).expect(201);
    await http().patch(`${API}/vendor/products/${kibbleProduct}`).set(bearer(vendorA.token)).send({}).expect(200);
    await prisma.productVariant.update({ where: { id: kibble7 }, data: { stock: 1 } });
    const c = await customer('+919822200041', 'Slow Payer');
    await http().put(`${API}/cart/items`).set(bearer(c.token)).send({ variantId: kibble7, qty: 1 }).expect(200);
    const r = (await place(c, 'ONCE').expect(201)).body.data;
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'ONCE' } })).usedCount).toBe(1);
    await prisma.order.update({ where: { id: r.order.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });

    // Someone else checks out: stale holds are released first, so they can buy the last unit.
    const other = await customer('+919822200042', 'Quick Buyer');
    await http().put(`${API}/cart/items`).set(bearer(other.token)).send({ variantId: kibble7, qty: 1 }).expect(400); // still held
    await prisma.productVariant.update({ where: { id: kibble3 }, data: { stock: 9 } });
    await http().put(`${API}/cart/items`).set(bearer(other.token)).send({ variantId: kibble3, qty: 1 }).expect(200);
    await place(other).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } })).status).toBe('EXPIRED');
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: kibble7 } })).stock).toBe(1); // released
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'ONCE' } })).usedCount).toBe(0);

    // Paying late while the unit is still free revives the order.
    await pay(c, r.payment.paymentId);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } })).status).toBe('PAID');
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: kibble7 } })).stock).toBe(0);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'ONCE' } })).usedCount).toBe(1);

    // Paying late after the stock is gone is refunded in full.
    await prisma.productVariant.update({ where: { id: kibble7 }, data: { stock: 1 } });
    const c3 = await customer('+919822200043', 'Too Late');
    await http().put(`${API}/cart/items`).set(bearer(c3.token)).send({ variantId: kibble7, qty: 1 }).expect(200);
    const r3 = (await place(c3).expect(201)).body.data;
    await prisma.order.update({ where: { id: r3.order.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    await http().put(`${API}/cart/items`).set(bearer(other.token)).send({ variantId: kibble3, qty: 1 }).expect(200);
    await place(other).expect(201); // expires r3
    await prisma.productVariant.update({ where: { id: kibble7 }, data: { stock: 0 } }); // sold elsewhere
    await pay(c3, r3.payment.paymentId);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r3.order.id } })).status).toBe('EXPIRED');
    expect(await prisma.refund.findUniqueOrThrow({ where: { reference: `Order:${r3.order.id}` } })).toMatchObject({ amountPaise: r3.order.totalPaise, reason: 'ORDER_UNFULFILLABLE' });
  });

  it('admins block products (they leave the shop and carts), and the feature switch hides the shop', async () => {
    const c = await customer('+919822200051', 'Blocked Cart');
    await prisma.productVariant.update({ where: { id: toy }, data: { stock: 5 } });
    await http().put(`${API}/cart/items`).set(bearer(c.token)).send({ variantId: toy, qty: 1 }).expect(200);
    const productId = (await prisma.productVariant.findUniqueOrThrow({ where: { id: toy } })).productId;
    await http().post(`${API}/admin/products/${productId}/block`).set(bearer(admin)).send({ blocked: true }).expect(400); // reason
    await http().post(`${API}/admin/products/${productId}/block`).set(bearer(admin)).send({ blocked: true, reason: 'Misleading claims' }).expect(200);
    expect((await http().get(`${API}/products`).expect(200)).body.data.map((p: { id: string }) => p.id)).not.toContain(productId);
    const cart = (await http().get(`${API}/cart`).set(bearer(c.token)).expect(200)).body.data;
    expect(cart).toMatchObject({ canCheckout: false, items: [{ problem: 'No longer available. Remove it to continue.' }] });
    expect((await http().patch(`${API}/vendor/products/${productId}`).set(bearer(vendorB.token)).send({ status: 'ACTIVE' }).expect(400)).body.message).toMatch(/blocked by PetApp: Misleading claims/);

    await prisma.featureFlag.update({ where: { key: 'ENABLE_MARKETPLACE' }, data: { enabled: false } });
    await redis.client.del('platform:flags');
    await http().get(`${API}/products`).expect(404);
    await prisma.featureFlag.update({ where: { key: 'ENABLE_MARKETPLACE' }, data: { enabled: true } });
    await redis.client.del('platform:flags');
  });

  it('sellers see their work, stock alerts and sales on a dashboard; inventory has a status per variant', async () => {
    const [kib3, kib7] = await Promise.all([kibble3, kibble7].map((id) => prisma.productVariant.findUniqueOrThrow({ where: { id } })));
    await prisma.productVariant.update({ where: { id: kibble3 }, data: { stock: 3 } }); // low (threshold 5)
    await prisma.productVariant.update({ where: { id: kibble7 }, data: { stock: 0 } }); // out
    const extra = await http()
      .patch(`${API}/vendor/products/${kibbleProduct}`)
      .set(bearer(vendorA.token))
      .send({ variants: [
        { sku: kib3.sku, title: kib3.title, mrpPaise: kib3.mrpPaise, pricePaise: kib3.pricePaise, gstRateBps: kib3.gstRateBps, stock: 3 },
        { sku: kib7.sku, title: kib7.title, mrpPaise: kib7.mrpPaise, pricePaise: kib7.pricePaise, gstRateBps: kib7.gstRateBps, stock: 0 },
        { sku: 'RK-15', title: '15 kg', mrpPaise: 699900, pricePaise: 649900, gstRateBps: 1800, stock: 40 },
        { sku: 'RK-1', title: '1 kg', mrpPaise: 69900, pricePaise: 59900, gstRateBps: 1800, stock: 12, isActive: false },
      ] })
      .expect(200);
    expect(extra.body.data.variants).toHaveLength(4);
    // Saving the product form again with an old count doesn't overwrite stock (orders move it meanwhile).
    const stale = await http()
      .patch(`${API}/vendor/products/${kibbleProduct}`)
      .set(bearer(vendorA.token))
      .send({ variants: extra.body.data.variants.map((v: { sku: string; title: string; mrpPaise: number; pricePaise: number; gstRateBps: number; isActive: boolean }) => ({ sku: v.sku, title: v.title, mrpPaise: v.mrpPaise, pricePaise: v.pricePaise, gstRateBps: v.gstRateBps, isActive: v.isActive, stock: 999 })) })
      .expect(200);
    expect(Object.fromEntries(stale.body.data.variants.map((v: { sku: string; stock: number }) => [v.sku, v.stock]))).toEqual({ 'RK-3': 3, 'RK-7': 0, 'RK-15': 40, 'RK-1': 12 });
    const mine = (await http().get(`${API}/vendor/products`).set(bearer(vendorA.token)).expect(200)).body.data;
    const statuses = Object.fromEntries(mine.find((p: { id: string }) => p.id === kibbleProduct).variants.map((v: { sku: string; inventoryStatus: string }) => [v.sku, v.inventoryStatus]));
    expect(statuses).toEqual({ 'RK-3': 'LOW_STOCK', 'RK-7': 'OUT_OF_STOCK', 'RK-15': 'IN_STOCK', 'RK-1': 'DISCONTINUED' });
    // The seller's list carries viewable photos, in the seller's order.
    for (const p of mine as Array<{ imageIds: string[]; images: Array<{ id: string; status: string }> }>) {
      expect(p.images.map((i) => i.id)).toEqual(p.imageIds);
      expect(p.images.every((i) => i.status === 'READY')).toBe(true);
    }
    // Shoppers see "only N left" from the same setting, and never see a discontinued variant.
    const page = (await http().get(`${API}/products/${kibbleProduct}`).expect(200)).body.data;
    expect(page.variants.map((v: { sku: string; lowStock: number | null }) => [v.sku, v.lowStock])).toEqual([['RK-3', 3], ['RK-7', null], ['RK-15', null]]);

    const d = (await http().get(`${API}/vendor/dashboard`).set(bearer(vendorA.token)).expect(200)).body.data;
    const count = (status: string) => prisma.subOrder.count({ where: { vendorId: vendorAId, status: status as never } });
    expect(d.todo).toEqual({
      toPack: await count('CONFIRMED'), toShip: await count('PACKED'), inTransit: await count('SHIPPED'),
      returnsToReview: await prisma.returnRequest.count({ where: { status: 'REQUESTED', subOrder: { vendorId: vendorAId } } }),
    });
    expect(d.stockAlerts.map((a: { sku: string; inventoryStatus: string }) => [a.sku, a.inventoryStatus])).toEqual([['RK-7', 'OUT_OF_STOCK'], ['RK-3', 'LOW_STOCK']]);
    // Sales windows start at midnight India time and leave out cancelled, returned and unpaid parcels.
    const IST = 330 * 60_000;
    const todayStart = new Date(Math.floor((Date.now() + IST) / 86_400_000) * 86_400_000 - IST);
    const sold = await prisma.subOrder.findMany({ where: { vendorId: vendorAId, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURN_REQUESTED'] }, createdAt: { gte: todayStart } } });
    expect(sold.length).toBeGreaterThan(0);
    expect(d.sales.today).toEqual({ orders: sold.length, salesPaise: sold.reduce((a, x) => a + x.totalPaise, 0), earningsPaise: sold.reduce((a, x) => a + x.vendorEarningPaise, 0) });
    expect(d.sales.last30Days.orders).toBeGreaterThanOrEqual(d.sales.last7Days.orders);
    const notSeller = await customer('+919822200061', 'Not A Seller'); // resolve before building the request
    await http().get(`${API}/vendor/dashboard`).set(bearer(notSeller.token)).expect(404);
  });

  it('sellers run their own coupons: their items only, their money, nobody else’s coupons', async () => {
    await prisma.productVariant.update({ where: { id: kibble3 }, data: { stock: 20 } });
    const bone = await http()
      .post(`${API}/vendor/products`)
      .set(bearer(vendorB.token))
      .send({ categoryId: toys, title: 'Rope Tug', description: 'Cotton rope toy.', imageIds: [(await media(vendorB.id, 'IMAGE')).id], variants: [{ sku: 'RT-1', title: 'Large', mrpPaise: 59900, pricePaise: 49900, gstRateBps: 1200, stock: 10 }] })
      .expect(201);
    await http().patch(`${API}/vendor/products/${bone.body.data.id}`).set(bearer(vendorB.token)).send({ status: 'ACTIVE' }).expect(200);
    const rope = bone.body.data.variants[0].id;

    const body = { code: 'chew20', kind: 'PERCENT', value: 2000, startsAt: hours(-1), endsAt: hours(48) };
    await http().post(`${API}/vendor/coupons`).set(bearer(vendorB.token)).send({ ...body, vendorId: vendorAId }).expect(400); // can't pick a seller
    const c = (await http().post(`${API}/vendor/coupons`).set(bearer(vendorB.token)).send(body).expect(201)).body.data;
    expect(c).toMatchObject({ code: 'CHEW20', vendorId: vendorBId });
    expect((await http().get(`${API}/vendor/coupons`).set(bearer(vendorA.token)).expect(200)).body.data.map((x: { code: string }) => x.code)).not.toContain('CHEW20');
    await http().patch(`${API}/vendor/coupons/${c.id}`).set(bearer(vendorA.token)).send({ isActive: false }).expect(404); // not A's
    const platformCoupon = await prisma.coupon.findUniqueOrThrow({ where: { code: 'PETS10' } });
    await http().patch(`${API}/vendor/coupons/${platformCoupon.id}`).set(bearer(vendorB.token)).send({ value: 9000 }).expect(404); // not B's either

    // Partial edits are checked as the coupon will be after the change.
    expect((await http().patch(`${API}/vendor/coupons/${c.id}`).set(bearer(vendorB.token)).send({ value: 15000 }).expect(400)).body.message).toMatch(/can’t exceed 100%/);
    expect((await http().patch(`${API}/vendor/coupons/${c.id}`).set(bearer(vendorB.token)).send({ endsAt: hours(-2) }).expect(400)).body.message).toMatch(/must end after it starts/);
    await http().patch(`${API}/admin/coupons/${platformCoupon.id}`).set(bearer(admin)).send({ value: 20000 }).expect(400); // the same check protects admin edits

    const shopper = await customer('+919822200062', 'Coupon Shopper');
    await http().put(`${API}/cart/items`).set(bearer(shopper.token)).send({ variantId: kibble3, qty: 1 }).expect(200);
    await http().put(`${API}/cart/items`).set(bearer(shopper.token)).send({ variantId: rope, qty: 2 }).expect(200);
    const pv = (await http().post(`${API}/checkout/preview`).set(bearer(shopper.token)).send({ couponCode: 'CHEW20' }).expect(200)).body.data;
    expect(pv.coupon).toEqual({ code: 'CHEW20', discountPaise: Math.floor((2 * 49900 * 2000) / 10_000), fundedBy: 'VENDOR' });
    expect(pv.parcels.find((p: { vendorId: string }) => p.vendorId === vendorAId).discountPaise).toBe(0); // A's kibble isn't discounted
    const r = (await place(shopper, 'CHEW20').expect(201)).body.data;
    const bSub = await prisma.subOrder.findFirstOrThrow({ where: { orderId: r.order.id, vendorId: vendorBId } });
    // The seller funds it: earnings = items − discount − commission (15% of the discounted price) + shipping.
    const items = 2 * 49900;
    const discount = Math.floor((items * 2000) / 10_000);
    expect(bSub).toMatchObject({ discountPaise: discount, commissionPaise: Math.round(((items - discount) * 1500) / 10_000), vendorEarningPaise: items - discount - Math.round(((items - discount) * 1500) / 10_000) + bSub.shippingPaise });

    const pending = await login('+919811100009', 'Unapproved Store');
    await http().post(`${API}/vendor/profile`).set(bearer(pending.token)).send({ businessName: 'Unapproved Store', phone: '9811100009', addressLine: '9 Lane', city: 'Pune', state: 'Maharashtra', pincode: '411001' }).expect(201);
    expect((await http().post(`${API}/vendor/coupons`).set(bearer(pending.token)).send({ ...body, code: 'EARLY10' }).expect(400)).body.message).toBe('Your store isn’t approved yet.');
    const all = (await http().get(`${API}/admin/coupons`).set(bearer(admin)).expect(200)).body.data;
    expect(all.find((x: { code: string }) => x.code === 'CHEW20').vendor).toMatchObject({ id: vendorBId, businessName: 'Chew Co' });
  });
});
