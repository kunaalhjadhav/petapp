import { HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import { Paged, type PaginationQuery } from '../../common/dto/pagination.dto';
import type { AssistantMessage, Prisma } from '../../generated/prisma/client';
import { ASSISTANT_PROVIDER, type AssistantProvider, type AssistantReply, type AssistantTurn } from '../../providers/ai/assistant.provider';
import { RecoService, type Who } from '../recommendations/reco.service';
import { AssistantTools, type Card } from './assistant.tools';
import { DOSE_REPLY, NOTICES, URGENT_REPLY, checkAnswer, titleFrom, triage } from './assistant.safety';
import { RulesAssistant } from './rules-assistant';
import type { AskDto } from './assistant.dto';

const IST_MS = 5.5 * 3_600_000;
const MAX_CARDS = 8;

/** Start of today in India, as a UTC instant. */
export const indiaMidnight = (now = new Date()) => new Date(Math.floor((now.getTime() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS);


@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly rules = new RulesAssistant();

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly reco: RecoService,
    private readonly tools: AssistantTools,
    @Inject(ASSISTANT_PROVIDER) private readonly provider: AssistantProvider,
  ) {}

  get providerInfo() {
    return { provider: this.provider.name, usesModel: this.provider.usesModel, model: (this.provider as { model?: string }).model ?? 'petapp-rules' };
  }

  /** What the app shows before the first question. */
  async info(userId: string) {
    const [limit, days, used, flags] = await Promise.all([
      this.platform.getSetting<number>('assistant.dailyMessages'),
      this.platform.getSetting<number>('assistant.historyDays'),
      this.usedToday(userId),
      this.platform.flags(),
    ]);
    const suggestions = [
      ...(flags.ENABLE_SERVICES ? ['Find a groomer near me'] : []),
      ...(flags.ENABLE_MARKETPLACE ? ['Food for my puppy'] : []),
      ...(flags.ENABLE_CONTESTS ? ['Which contests can my pet enter?'] : []),
      'How do I add my pet?',
      'Which foods are poisonous to dogs?',
    ];
    return {
      name: 'PetApp Assistant',
      usesModel: this.provider.usesModel,
      intro: 'Ask me to find services, products, contests and challenges, explain how the app works, or share general pet-care tips.',
      healthNotice: 'I’m not a vet. I can share general information, but I can’t diagnose or suggest medicine doses. In an emergency, contact a vet straight away.',
      privacy: `Your chats are kept for ${days} days so you can come back to them, and you can delete them at any time.${this.provider.usesModel ? ' Questions are answered with the help of an AI model from our provider.' : ''}`,
      dailyLimit: limit,
      usedToday: used,
      suggestions,
    };
  }

  private async usedToday(userId: string) {
    return this.prisma.assistantMessage.count({ where: { role: 'USER', conversation: { userId }, createdAt: { gte: indiaMidnight() } } });
  }

  /** Answers one question, in a new or existing conversation. */
  async ask(userId: string, dto: AskDto) {
    const text = dto.text.trim();
    const limit = await this.platform.getSetting<number>('assistant.dailyMessages');
    if ((await this.usedToday(userId)) >= limit) {
      throw new HttpException(`You’ve asked ${limit} questions today, the daily limit. You can ask again tomorrow.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const conversation = dto.conversationId
      ? await this.prisma.assistantConversation.findFirst({ where: { id: dto.conversationId, userId } })
      : await this.prisma.assistantConversation.create({ data: { userId, title: titleFrom(text) } });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    const history = (
      await this.prisma.assistantMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: 10, select: { role: true, text: true } })
    )
      .reverse()
      .map((m) => ({ role: m.role === 'USER' ? ('user' as const) : ('assistant' as const), text: m.text }));
    const question = await this.prisma.assistantMessage.create({ data: { conversationId: conversation.id, role: 'USER', text } });

    const who = await this.reco.who(userId, { lat: dto.lat, lng: dto.lng });
    const allowed = await this.tools.specs();
    const started = Date.now();
    const t = triage(text);
    let session = this.tools.session(who, allowed);
    let reply: AssistantReply;
    let error: string | null = null;
    let provider = this.provider.name;

    if (t.safety === 'URGENT' || t.asksForDose) {
      // Fixed answers for emergencies and medicine doses; no model is asked. Offer nearby vets.
      const calls: AssistantReply['toolCalls'] = [];
      if (allowed.some((x) => x.name === 'find_services')) {
        calls.push({ name: 'find_services', input: { category: 'vet' } });
        await session.run('find_services', { category: 'vet' });
      }
      if (t.signs.includes('poisoning')) {
        calls.push({ name: 'pet_care', input: { topic: 'toxic foods' } });
        await session.run('pet_care', { topic: 'toxic foods' });
      }
      reply = { text: t.safety === 'URGENT' ? URGENT_REPLY : DOSE_REPLY, toolCalls: calls, model: 'petapp-safety', version: 'safety-v1' };
      provider = 'safety';
    } else {
      const turn: AssistantTurn = { history, text, context: this.context(who), tools: allowed };
      try {
        reply = await this.provider.reply(turn, session.run);
      } catch (e) {
        if (!this.provider.usesModel) throw e;
        // The model is unavailable: answer with the built-in assistant rather than failing the person.
        error = (e as Error).message.slice(0, 500);
        this.logger.warn(`assistant model failed, using rules: ${error}`);
        session = this.tools.session(who, allowed);
        reply = await this.rules.reply(turn, session.run);
        provider = 'rules';
      }
      const safe = checkAnswer(reply.text, t.safety);
      if (safe) reply = { ...reply, text: safe };
    }

    const answer = await this.prisma.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        text: reply.text.slice(0, 8000),
        cards: session.cards.slice(0, MAX_CARDS) as unknown as Prisma.InputJsonValue,
        safety: t.safety,
        tools: reply.toolCalls as unknown as Prisma.InputJsonValue,
        provider,
        model: reply.model,
        version: reply.version,
        latencyMs: Date.now() - started,
        inputTokens: reply.inputTokens ?? null,
        outputTokens: reply.outputTokens ?? null,
        error,
      },
    });
    await this.prisma.assistantConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: answer.createdAt } });
    return { conversation: { id: conversation.id, title: conversation.title }, question: this.view(question), answer: this.view(answer) };
  }

  /** Facts the model may use. Kept minimal: pets' names, species and ages, and whether a location is set. */
  private context(who: Who) {
    const pets = who.pets.length
      ? who.pets.map((p) => `${p.name} (${p.speciesName.toLowerCase()}${p.stage ? `, ${p.stage}` : ''})`).join(', ')
      : 'no pets added';
    const place = who.lat !== undefined ? `location set${who.city ? ` (${who.city})` : ''}` : 'no location set';
    return `pets: ${pets}; ${place}.`;
  }

  view(m: AssistantMessage) {
    return {
      id: m.id,
      role: m.role,
      text: m.text,
      cards: m.cards as unknown as Card[],
      safety: m.safety,
      notice: m.safety === 'NONE' ? null : NOTICES[m.safety],
      rating: m.rating,
      createdAt: m.createdAt,
    };
  }

  async conversations(userId: string, q: PaginationQuery) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.assistantConversation.findMany({ where: { userId }, orderBy: { lastMessageAt: 'desc' }, skip: q.skip, take: q.limit, select: { id: true, title: true, createdAt: true, lastMessageAt: true } }),
      this.prisma.assistantConversation.count({ where: { userId } }),
    ]);
    return Paged.of(items, total, q);
  }

  async conversation(userId: string, id: string) {
    const c = await this.prisma.assistantConversation.findFirst({ where: { id, userId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!c) throw new NotFoundException('Conversation not found.');
    return { id: c.id, title: c.title, createdAt: c.createdAt, lastMessageAt: c.lastMessageAt, messages: c.messages.map((m) => this.view(m)) };
  }

  async remove(userId: string, id: string) {
    const r = await this.prisma.assistantConversation.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Conversation not found.');
  }

  async removeAll(userId: string) {
    const r = await this.prisma.assistantConversation.deleteMany({ where: { userId } });
    return { deleted: r.count };
  }

  /** Thumbs up or down on an answer. A thumbs-down (with its question) is shared with the PetApp team to improve answers. */
  async rate(userId: string, messageId: string, rating: 'UP' | 'DOWN', note?: string) {
    const m = await this.prisma.assistantMessage.findFirst({ where: { id: messageId, role: 'ASSISTANT', conversation: { userId } } });
    if (!m) throw new NotFoundException('Answer not found.');
    const r = await this.prisma.assistantMessage.update({ where: { id: m.id }, data: { rating, ratingNote: note?.trim() || null, ratedAt: new Date() } });
    return this.view(r);
  }

  // ═════════════ admin ═════════════

  async status() {
    const since = new Date(Date.now() - 86_400_000);
    const [enabled, limit, days, bySafety, byProvider, ratings, fallbacks, avg] = await Promise.all([
      this.platform.isEnabled('ENABLE_AI_ASSISTANT'),
      this.platform.getSetting<number>('assistant.dailyMessages'),
      this.platform.getSetting<number>('assistant.historyDays'),
      this.prisma.assistantMessage.groupBy({ by: ['safety'], where: { role: 'ASSISTANT', createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.assistantMessage.groupBy({ by: ['provider'], where: { role: 'ASSISTANT', createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.assistantMessage.groupBy({ by: ['rating'], where: { role: 'ASSISTANT', rating: { not: null }, ratedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _count: { _all: true } }),
      this.prisma.assistantMessage.count({ where: { role: 'ASSISTANT', error: { not: null }, createdAt: { gte: since } } }),
      this.prisma.assistantMessage.aggregate({ where: { role: 'ASSISTANT', createdAt: { gte: since } }, _avg: { latencyMs: true }, _sum: { inputTokens: true, outputTokens: true } }),
    ]);
    const count = <T extends string | null>(rows: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string) =>
      Object.fromEntries(rows.map((r) => [String(r[key] as T), r._count._all]));
    const s = count(bySafety, 'safety');
    return {
      ...this.providerInfo,
      enabled,
      dailyLimit: limit,
      historyDays: days,
      last24h: {
        answers: Object.values(s).reduce((a, b) => a + b, 0),
        urgent: s.URGENT ?? 0,
        healthInfo: s.GENERAL_INFO ?? 0,
        byProvider: count(byProvider, 'provider'),
        modelFailures: fallbacks,
        avgLatencyMs: Math.round(avg._avg.latencyMs ?? 0),
        inputTokens: avg._sum.inputTokens ?? 0,
        outputTokens: avg._sum.outputTokens ?? 0,
      },
      ratings30d: { up: count(ratings, 'rating').UP ?? 0, down: count(ratings, 'rating').DOWN ?? 0 },
    };
  }

  /** Rated answers, with the question each answered, newest first. Only answers people chose to rate are shown. */
  async feedback(q: PaginationQuery & { rating?: 'UP' | 'DOWN' }) {
    const where: Prisma.AssistantMessageWhereInput = { role: 'ASSISTANT', rating: q.rating ?? { not: null } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.assistantMessage.findMany({ where, orderBy: { ratedAt: 'desc' }, skip: q.skip, take: q.limit }),
      this.prisma.assistantMessage.count({ where }),
    ]);
    const questions = await Promise.all(
      rows.map((r) => this.prisma.assistantMessage.findFirst({ where: { conversationId: r.conversationId, role: 'USER', createdAt: { lte: r.createdAt } }, orderBy: { createdAt: 'desc' }, select: { text: true } })),
    );
    return Paged.of(
      rows.map((r, i) => ({
        id: r.id,
        question: questions[i]?.text ?? null,
        answer: r.text,
        rating: r.rating,
        note: r.ratingNote,
        safety: r.safety,
        cards: (r.cards as unknown as Card[]).map((c) => c.type),
        tools: r.tools,
        provider: r.provider,
        model: r.model,
        version: r.version,
        error: r.error,
        ratedAt: r.ratedAt,
      })),
      total,
      q,
    );
  }
}
