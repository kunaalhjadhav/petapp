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
import { AiError } from '../src/providers/ai/ai.provider';
import { ASSISTANT_PROVIDER, type AssistantProvider, type AssistantTurn, type ToolRunner } from '../src/providers/ai/assistant.provider';
import { RulesAssistant } from '../src/modules/assistant/rules-assistant';
import { AssistantRetention } from '../src/modules/assistant/assistant-retention';
import { DOSE_REPLY, URGENT_REPLY } from '../src/modules/assistant/assistant.safety';
import { syncRbac } from '../src/modules/rbac/rbac.seed';

const API = '/api/v1';
jest.setTimeout(120_000);
type User = { token: string; id: string };
const DAY = 86_400_000;
const PUNE = { lat: 18.5204, lng: 73.8567 };

/**
 * A scripted model: "[tool]" makes it look up groomers, "[amount]" answers with a dose, "[fail]" is an outage;
 * anything else goes to the built-in assistant. It records every turn it was given.
 */
class ScriptedAssistant implements AssistantProvider {
  readonly name = 'scripted';
  readonly usesModel = true;
  readonly model = 'scripted-1';
  readonly turns: AssistantTurn[] = [];
  private readonly rules = new RulesAssistant();
  async reply(turn: AssistantTurn, run: ToolRunner) {
    this.turns.push(turn);
    if (turn.text.includes('[fail]')) throw new AiError('model overloaded', true);
    if (turn.text.includes('[amount]')) return { text: 'Give 5 mg twice a day with food.', toolCalls: [], model: this.model, version: 'test', inputTokens: 10, outputTokens: 5 };
    if (turn.text.includes('[tool]')) {
      const found = (await run('find_services', { category: 'grooming' })) as { results: Array<{ name: string }> };
      return { text: `Try ${found.results.map((r) => r.name).join(' or ')}.`, toolCalls: [{ name: 'find_services', input: { category: 'grooming' } }], model: this.model, version: 'test', inputTokens: 120, outputTokens: 30 };
    }
    return this.rules.reply(turn, run);
  }
}

describe('PetApp Assistant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const scripted = new ScriptedAssistant();
  const inbox = new Map<string, string>();
  let admin: string;
  let moderator: string;
  let alice: User;
  let bob: User;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
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
  async function staff(email: string, role: string) {
    const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
    await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash('Staff-Password-1', 10), roles: { create: [{ roleId: r.id }] } } });
    return (await http().post(`${API}/admin/auth/login`).send({ email, password: 'Staff-Password-1' }).expect(200)).body.data.tokens.accessToken as string;
  }
  const ask = async (u: User, text: string, extra: Record<string, unknown> = {}, expect = 200) => {
    await unthrottle();
    return (await http().post(`${API}/assistant/messages`).set(bearer(u.token)).send({ text, ...extra }).expect(expect)).body;
  };
  const flag = async (key: string, enabled: boolean) => {
    await prisma.featureFlag.upsert({ where: { key }, update: { enabled }, create: { key, enabled } });
    await redis.client.del('platform:flags');
  };
  const cardTypes = (a: { cards: Array<{ type: string }> }) => a.cards.map((c) => c.type);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({ name: 'capture', send: async (m: SmsMessage) => (inbox.set(m.to, m.body.match(/\d{6}/)![0]), {}) })
      .overrideProvider(ASSISTANT_PROVIDER)
      .useValue(scripted)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await redis.client.flushdb();
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await syncRbac(prisma);
    await prisma.featureFlag.createMany({ data: ['ENABLE_CONTESTS', 'ENABLE_SERVICES', 'ENABLE_MARKETPLACE'].map((key) => ({ key, enabled: true })) });
    admin = await staff('root@assistant.test', 'SUPER_ADMIN');
    moderator = await staff('mod@assistant.test', 'MODERATOR');
    alice = await login('+919750000001', 'Alice Rao');
    bob = await login('+919750000002', 'Bob Nair');
    const dog = (await prisma.petSpecies.create({ data: { key: 'dog', name: 'Dog' } })).id;
    await prisma.pet.create({ data: { ownerId: alice.id, name: 'Bruno', handle: 'bruno', speciesId: dog, dateOfBirth: new Date(Date.now() - 0.4 * 365 * DAY) } });

    const groom = await prisma.serviceCategory.create({ data: { key: 'grooming', name: 'Grooming' } });
    const vet = await prisma.serviceCategory.create({ data: { key: 'vet', name: 'Vet consultation' } });
    let n = 0;
    const partner = async (name: string, categoryId: string, dLat: number) => {
      const owner = await prisma.user.create({ data: { phone: `+9197600000${++n}`, name } });
      const p = await prisma.servicePartner.create({
        data: { userId: owner.id, slug: name.toLowerCase().replace(/\s/g, '-'), businessName: name, phone: '+919800000001', addressLine: '1 Lane', city: 'Pune', state: 'MH', pincode: '411001', lat: PUNE.lat + dLat, lng: PUNE.lng, status: 'APPROVED', ratingAvg: 4.6, ratingCount: 12,
          services: { create: [{ categoryId, name: 'Visit', durationMin: 30, pricePaise: 50000, modes: ['AT_CENTER'] }] } },
      });
      await prisma.$executeRaw`UPDATE "ServicePartner" SET "location" = ST_SetSRID(ST_MakePoint(${PUNE.lng}, ${PUNE.lat + dLat}), 4326)::geography WHERE "id" = ${p.id}::uuid`;
    };
    await partner('Wag Spa', groom.id, 0.01);
    await partner('Paw Clinic', vet.id, 0.02);

    const seller = await prisma.user.create({ data: { phone: '+919760000099', name: 'Seller' } });
    const vendor = await prisma.vendor.create({ data: { userId: seller.id, businessName: 'Paws Mart', slug: 'paws-mart', phone: '+919800000000', addressLine: '1 Road', city: 'Pune', state: 'MH', pincode: '411001', status: 'APPROVED' } });
    const food = await prisma.productCategory.create({ data: { key: 'food', name: 'Food' } });
    await prisma.product.create({ data: { vendorId: vendor.id, categoryId: food.id, title: 'Puppy kibble', slug: 'puppy-kibble', description: 'x', speciesIds: [dog], status: 'ACTIVE', variants: { create: [{ sku: 'p1', title: '1 kg', mrpPaise: 50000, pricePaise: 45000, stock: 5 }] } } });

    await prisma.contest.create({
      data: { slug: 'cutest-puppy', title: 'Cutest Puppy', description: 'x', status: 'LIVE', createdById: alice.id, feePaise: 9900, publicWeight: 40, votesPerUserPerDay: 2, eligibleSpeciesIds: [dog],
        registrationOpensAt: new Date(Date.now() - DAY), registrationClosesAt: new Date(Date.now() + 5 * DAY), submissionClosesAt: new Date(Date.now() + 7 * DAY), votingClosesAt: new Date(Date.now() + 9 * DAY),
        tasks: { create: [{ type: 'POST', title: 'Best photo', position: 0 }] } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('is off until the feature switch is on; then explains itself', async () => {
    await http().get(`${API}/assistant`).set(bearer(alice.token)).expect(404);
    await flag('ENABLE_AI_ASSISTANT', true);
    const info = (await http().get(`${API}/assistant`).set(bearer(alice.token)).expect(200)).body.data;
    expect(info).toMatchObject({ name: 'PetApp Assistant', usesModel: true, dailyLimit: 40, usedToday: 0 });
    expect(info.healthNotice).toMatch(/not a vet/);
    expect(info.privacy).toMatch(/kept for 30 days.*AI model/);
    expect(info.suggestions).toEqual(expect.arrayContaining(['Find a groomer near me', 'Food for my puppy', 'Which contests can my pet enter?']));
    await http().get(`${API}/assistant`).expect(401);
  });

  it('finds services near them (and asks for a place without one), products, contests and contest rules, with cards', async () => {
    let r = (await ask(alice, 'Find a groomer near me', PUNE)).data;
    expect(r.conversation.title).toBe('Find a groomer near me');
    expect(r.question).toMatchObject({ role: 'USER', text: 'Find a groomer near me' });
    expect(r.answer).toMatchObject({ role: 'ASSISTANT', safety: 'NONE', notice: null });
    expect(r.answer.text).toMatch(/grooming partners near you/);
    expect(r.answer.cards).toEqual([{ type: 'SERVICE', item: expect.objectContaining({ businessName: 'Wag Spa', distanceKm: 1.1, fromPaise: 50000 }) }]);

    r = (await ask(alice, 'find a vet near me')).data;
    expect(r.answer.text).toMatch(/choose your location/);
    expect(cardTypes(r.answer)).toEqual(['LINK']);

    r = (await ask(alice, 'buy puppy food')).data;
    expect(r.answer.cards[0]).toMatchObject({ type: 'PRODUCT', item: { title: 'Puppy kibble', fromPaise: 45000 } });

    r = (await ask(alice, 'Which contests can Bruno enter?')).data;
    expect(r.answer.cards[0]).toMatchObject({ type: 'CONTEST', item: { title: 'Cutest Puppy', reason: 'Bruno can enter' } });

    r = (await ask(alice, 'What are the rules of the Cutest Puppy contest?')).data;
    expect(r.answer.text).toContain('Cutest Puppy: entry fee ₹99, open to Dog.');
    expect(r.answer.text).toContain('Judges decide 60% of the score and public votes 40%; each person gets 2 vote(s) a day.');
    expect(r.answer.text).toContain('To submit: Best photo.');

    r = (await ask(alice, 'How do I add my pet?')).data;
    expect(r.answer.text).toMatch(/^Add a pet:\n1\. Open Me\./);
    expect(r.answer.cards).toEqual([{ type: 'LINK', item: expect.objectContaining({ route: '/pets/new' }) }]);
  });

  it('emergencies get a fixed "see a vet now" answer with nearby vets, without asking the model', async () => {
    const before = scripted.turns.length;
    const r = (await ask(alice, 'Help, my dog ate a whole bar of chocolate!', PUNE)).data.answer;
    expect(scripted.turns.length).toBe(before);
    expect(r).toMatchObject({ safety: 'URGENT', text: URGENT_REPLY, notice: expect.stringMatching(/emergency/) });
    expect(cardTypes(r)).toEqual(['SERVICE', 'CARE']);
    expect(r.cards[0].item.businessName).toBe('Paw Clinic');
    expect(r.cards[1].item.id).toBe('toxic-foods');
    const stored = await prisma.assistantMessage.findUniqueOrThrow({ where: { id: r.id } });
    expect(stored).toMatchObject({ provider: 'safety', model: 'petapp-safety' });
  });

  it('never gives doses: dose questions get a fixed answer, and doses in health answers are replaced', async () => {
    let r = (await ask(alice, 'How much paracetamol can I give my dog?')).data.answer;
    expect(r).toMatchObject({ safety: 'GENERAL_INFO', text: DOSE_REPLY, notice: expect.stringMatching(/not a diagnosis/) });
    r = (await ask(alice, '[amount] my dog keeps itching')).data.answer;
    expect(r).toMatchObject({ safety: 'GENERAL_INFO', text: DOSE_REPLY });
    r = (await ask(alice, 'my dog has fleas')).data.answer;
    expect(r.safety).toBe('GENERAL_INFO');
    expect(cardTypes(r)).toEqual(['CARE']);
  });

  it('uses the model with tools, keeps the conversation, and falls back to the built-in answers when the model is down', async () => {
    const first = (await ask(alice, '[tool] groomers?', PUNE)).data;
    expect(first.answer.text).toBe('Try Wag Spa.');
    expect(cardTypes(first.answer)).toEqual(['SERVICE']);
    const stored = await prisma.assistantMessage.findUniqueOrThrow({ where: { id: first.answer.id } });
    expect(stored).toMatchObject({ provider: 'scripted', model: 'scripted-1', inputTokens: 120, outputTokens: 30, tools: [{ name: 'find_services', input: { category: 'grooming' } }] });

    const next = (await ask(alice, 'and what about grooming at home?', { conversationId: first.conversation.id, ...PUNE })).data;
    expect(next.conversation.id).toBe(first.conversation.id);
    const turn = scripted.turns.at(-1)!;
    expect(turn.history).toEqual([{ role: 'user', text: '[tool] groomers?' }, { role: 'assistant', text: 'Try Wag Spa.' }]);
    expect(turn.context).toBe('pets: Bruno (dog, young); location set.');

    const down = (await ask(alice, '[fail] find a groomer near me', PUNE)).data.answer;
    expect(down.text).toMatch(/grooming partners near you/);
    expect(await prisma.assistantMessage.findUniqueOrThrow({ where: { id: down.id } })).toMatchObject({ provider: 'rules', error: expect.stringMatching(/overloaded/) });

    // Someone else's conversation can't be continued or read.
    await ask(bob, 'hello', { conversationId: first.conversation.id }, 404);
    await http().get(`${API}/assistant/conversations/${first.conversation.id}`).set(bearer(bob.token)).expect(404);
    const mine = (await http().get(`${API}/assistant/conversations/${first.conversation.id}`).set(bearer(alice.token)).expect(200)).body.data;
    expect(mine.messages.map((m: { role: string }) => m.role)).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
  });

  it('switched-off parts of the app are not offered', async () => {
    await flag('ENABLE_MARKETPLACE', false);
    const r = (await ask(alice, 'buy puppy food')).data.answer;
    expect(r.text).toBe('The shop isn’t open in the app yet.');
    expect(r.cards).toEqual([]);
    await flag('ENABLE_MARKETPLACE', true);
  });

  it('a daily limit per person', async () => {
    const used = (await http().get(`${API}/assistant`).set(bearer(alice.token)).expect(200)).body.data.usedToday;
    expect(used).toBeGreaterThan(10);
    await http().put(`${API}/admin/settings/assistant.dailyMessages`).set(bearer(admin)).send({ value: used }).expect(200);
    expect((await ask(alice, 'one more?', {}, 429)).message).toMatch(/daily limit/);
    await ask(bob, 'hello'); // others are unaffected
    await http().put(`${API}/admin/settings/assistant.dailyMessages`).set(bearer(admin)).send({ value: 0 }).expect(400);
    await http().put(`${API}/admin/settings/assistant.dailyMessages`).set(bearer(admin)).send({ value: 40 }).expect(200);
  });

  it('ratings: people rate answers; staff see only rated answers, with the question', async () => {
    const r = (await ask(alice, 'How do I post a reel?')).data;
    await http().post(`${API}/assistant/messages/${r.answer.id}/rating`).set(bearer(bob.token)).send({ rating: 'DOWN' }).expect(404);
    await http().post(`${API}/assistant/messages/${r.question.id}/rating`).set(bearer(alice.token)).send({ rating: 'UP' }).expect(404); // not an answer
    const rated = (await http().post(`${API}/assistant/messages/${r.answer.id}/rating`).set(bearer(alice.token)).send({ rating: 'DOWN', note: 'I wanted video tips' }).expect(200)).body.data;
    expect(rated.rating).toBe('DOWN');
    const fb = (await http().get(`${API}/admin/assistant/feedback?rating=DOWN`).set(bearer(moderator)).expect(200)).body;
    expect(fb.data).toEqual([expect.objectContaining({ question: 'How do I post a reel?', rating: 'DOWN', note: 'I wanted video tips', cards: ['LINK'], provider: 'scripted' })]);
    expect(fb.meta.total).toBe(1);
    const status = (await http().get(`${API}/admin/assistant/status`).set(bearer(admin)).expect(200)).body.data;
    expect(status).toMatchObject({ provider: 'scripted', usesModel: true, enabled: true, dailyLimit: 40, historyDays: 30, ratings30d: { up: 0, down: 1 } });
    expect(status.last24h).toMatchObject({ urgent: 1, modelFailures: 1 });
    expect(status.last24h.byProvider).toMatchObject({ safety: 2, rules: expect.any(Number), scripted: expect.any(Number) });
    await http().get(`${API}/admin/assistant/status`).set(bearer(alice.token)).expect(403);
  });

  it('people delete their conversations; old ones are deleted automatically', async () => {
    const list = (await http().get(`${API}/assistant/conversations`).set(bearer(alice.token)).expect(200)).body;
    expect(list.meta.total).toBeGreaterThan(5);
    await http().delete(`${API}/assistant/conversations/${list.data[0].id}`).set(bearer(bob.token)).expect(404);
    await http().delete(`${API}/assistant/conversations/${list.data[0].id}`).set(bearer(alice.token)).expect(204);
    const all = (await http().delete(`${API}/assistant/conversations`).set(bearer(alice.token)).expect(200)).body.data;
    expect(all.deleted).toBe(list.meta.total - 1);

    const old = await prisma.assistantConversation.findFirstOrThrow({ where: { userId: bob.id } });
    await prisma.assistantConversation.update({ where: { id: old.id }, data: { lastMessageAt: new Date(Date.now() - 31 * DAY) } });
    expect(await app.get(AssistantRetention).purge()).toBe(1);
    expect(await prisma.assistantMessage.count({ where: { conversationId: old.id } })).toBe(0);
  });
});
