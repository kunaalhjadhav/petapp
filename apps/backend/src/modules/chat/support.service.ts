import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@petapp/types';
import { Prisma } from '../../generated/prisma/client';
import type { TicketStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { RedisService } from '../../redis/redis.service';
import { likeText } from '../../common/utils/search';
import { Paged } from '../../common/dto/pagination.dto';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { RbacService } from '../rbac/rbac.service';
import { ChatRealtime } from './chat.realtime';
import { ChatService } from './chat.service';
import { TICKET_STATUS_LABEL, afterStaffReply, audienceFilter, previewOf, staffCanMove, ticketCode, type Audience } from './chat.rules';
import type {
  AdminTicketsQuery, CategoryDto, CreateTicketDto, FaqDto, FaqQuery, MessagesQuery, StaffReplyDto, StaffStartTicketDto, UpdateCategoryDto, UpdateFaqDto, UpdateTicketDto,
} from './chat.dto';

const APP_AUDIENCE: Record<'customer' | 'partner' | 'seller', Audience> = { customer: 'CUSTOMER', partner: 'PARTNER', seller: 'SELLER' };
const ACTIVE: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'];

const ticketInclude = {
  category: { select: { id: true, key: true, name: true } },
  user: { select: { id: true, name: true, phone: true, email: true, status: true, avatarUrl: true } },
  assignee: { select: { id: true, name: true } },
  conversation: { select: { id: true, lastMessageAt: true, lastMessageText: true, otherUnread: true, customerUnread: true, customerReadAt: true, otherReadAt: true } },
} satisfies Prisma.SupportTicketInclude;

/**
 * Support center (spec §58): FAQs, tickets with categories, priority and statuses, attachments, and staff replies.
 * A ticket's thread is a SUPPORT conversation, so people reply from the same chat screen, with live updates.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly chat: ChatService,
    private readonly realtime: ChatRealtime,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly redis: RedisService,
  ) {}

  // ───────────── help center (no sign-in) ─────────────

  async faqs(q: FaqQuery) {
    const audience = APP_AUDIENCE[q.app];
    const where: Prisma.SupportFaqWhereInput = {
      published: true,
      audience: audienceFilter(audience),
      OR: [{ categoryId: null }, { category: { active: true } }],
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.q ? { AND: [{ OR: [{ question: { contains: likeText(q.q), mode: 'insensitive' } }, { answer: { contains: likeText(q.q), mode: 'insensitive' } }] }] } : {}),
    };
    const [faqs, categories] = await Promise.all([
      this.prisma.supportFaq.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 200, select: { id: true, question: true, answer: true, categoryId: true } }),
      this.categories(q.app),
    ]);
    return { categories, faqs };
  }

  categories(app: 'customer' | 'partner' | 'seller') {
    return this.prisma.supportCategory.findMany({
      where: { active: true, audience: audienceFilter(APP_AUDIENCE[app]) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, key: true, name: true },
    });
  }

  /** "Was this helpful?" Counted once per FAQ per network address per day. */
  async feedback(id: string, helpful: boolean, ip: string | undefined) {
    const faq = await this.prisma.supportFaq.findFirst({ where: { id, published: true }, select: { id: true } });
    if (!faq) throw new NotFoundException('Question not found.');
    const fresh = await this.redis.client.set(`faq:fb:${id}:${ip ?? 'unknown'}`, '1', 'EX', 86_400, 'NX');
    if (fresh) await this.prisma.supportFaq.update({ where: { id }, data: helpful ? { helpful: { increment: 1 } } : { notHelpful: { increment: 1 } } });
    return { thanks: true };
  }

  // ───────────── tickets (the person) ─────────────

  async create(userId: string, dto: CreateTicketDto) {
    const audience = APP_AUDIENCE[dto.app];
    if (dto.app === 'partner' && !(await this.prisma.servicePartner.count({ where: { userId } }))) throw new ForbiddenException('Only service partners can ask for help from the partner app.');
    if (dto.app === 'seller' && !(await this.prisma.vendor.count({ where: { userId } }))) throw new ForbiddenException('Only sellers can ask for help from the seller app.');
    const category = await this.prisma.supportCategory.findFirst({ where: { id: dto.categoryId, active: true, audience: audienceFilter(audience) } });
    if (!category) throw new BadRequestException('Choose one of the topics shown.');
    if (!!dto.refType !== !!dto.refId) throw new BadRequestException('Pick the booking or order this is about.');
    if (dto.refType === 'BOOKING' && !(await this.prisma.booking.count({ where: { id: dto.refId, OR: [{ customerId: userId }, { partner: { userId } }] } }))) throw new NotFoundException('Booking not found.');
    if (dto.refType === 'ORDER' && !(await this.prisma.subOrder.count({ where: { id: dto.refId, OR: [{ order: { userId } }, { vendor: { userId } }] } }))) throw new NotFoundException('Order not found.');
    const mediaIds = [...new Set(dto.mediaIds ?? [])];
    if (mediaIds.length > 5) throw new BadRequestException('Attach up to 5 files.');
    const media = await Promise.all(mediaIds.map((id) => this.chat.attachable(userId, id, true)));

    const open = await this.prisma.supportTicket.count({ where: { userId, status: { in: ACTIVE } } });
    if (open >= (await this.platform.getSetting<number>('support.maxOpenTickets'))) {
      throw new HttpException('You already have several open tickets. Reply in one of them, and we’ll get back to you.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const ticket = await this.withCode(async (code) =>
      this.prisma.$transaction(async (tx) => {
        const conv = await tx.conversation.create({ data: { kind: 'SUPPORT', customerId: userId } });
        const t = await tx.supportTicket.create({
          data: { code, userId, categoryId: category.id, subject: dto.subject, conversationId: conv.id, app: audience, refType: dto.refType ?? null, refId: dto.refId ?? null, createdById: userId },
        });
        const first = await tx.chatMessage.create({ data: { conversationId: conv.id, senderId: userId, side: 'CUSTOMER', body: dto.body, refType: dto.refType ?? null, refId: dto.refId ?? null } });
        let last = first;
        const ids = [first.id];
        for (const m of media) {
          last = await tx.chatMessage.create({ data: { conversationId: conv.id, senderId: userId, side: 'CUSTOMER', mediaId: m.id } });
          ids.push(last.id);
        }
        await tx.conversation.update({
          where: { id: conv.id },
          data: { lastMessageAt: last.createdAt, lastMessageText: previewOf({ body: dto.body }), otherUnread: 1 + media.length, customerReadAt: last.createdAt },
        });
        return { t, ids };
      }),
    );
    if (await this.platform.getSetting<boolean>('chat.aiCheck')) for (const id of ticket.ids) this.queue.assess('CHAT_MESSAGE', id);
    return this.mine(userId, ticket.t.id);
  }

  async myTickets(userId: string, app?: 'customer' | 'partner' | 'seller') {
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId, ...(app ? { app: { in: [APP_AUDIENCE[app], 'STAFF'] } } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
      take: 100,
      include: ticketInclude,
    });
    return rows.map((t) => this.personView(t));
  }

  async mine(userId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId }, include: ticketInclude });
    if (!t) throw new NotFoundException('Ticket not found.');
    return this.personView(t);
  }

  async closeMine(userId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId } });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (t.status !== 'CLOSED') await this.setStatus(t.id, t.status, 'CLOSED', null, 'You closed this ticket.');
    return this.mine(userId, id);
  }

  private personView(t: Prisma.SupportTicketGetPayload<{ include: typeof ticketInclude }>) {
    return {
      id: t.id, code: t.code, subject: t.subject, status: t.status, statusLabel: TICKET_STATUS_LABEL[t.status],
      category: t.category.name, conversationId: t.conversation.id, refType: t.refType, refId: t.refId,
      unread: t.conversation.customerUnread, lastMessageText: t.conversation.lastMessageText, lastMessageAt: t.conversation.lastMessageAt,
      canReply: t.status !== 'CLOSED', createdAt: t.createdAt, updatedAt: t.updatedAt,
    };
  }

  // ───────────── tickets (staff) ─────────────

  async adminList(actor: Principal, q: AdminTicketsQuery) {
    const where: Prisma.SupportTicketWhereInput = {
      ...(q.status === 'active' || !q.status ? { status: { in: ACTIVE } } : { status: q.status as TicketStatus }),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.assignee === 'me' ? { assigneeId: actor.userId } : q.assignee === 'none' ? { assigneeId: null } : q.assignee ? { assigneeId: q.assignee } : {}),
      ...(q.q ? { OR: this.search(q.q) } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({ where, orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }], skip: q.skip, take: q.limit, include: ticketInclude }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return Paged.of(rows.map((t) => this.staffListView(t)), total, q);
  }

  private search(text: string): Prisma.SupportTicketWhereInput[] {
    const like = { contains: likeText(text), mode: 'insensitive' as const };
    const digits = text.replace(/\D/g, '');
    return [
      { code: text.toUpperCase() },
      { subject: like },
      { user: { name: like } },
      { user: { email: like } },
      ...(digits.length >= 5 ? [{ user: { phone: { contains: digits } } }] : []),
    ];
  }

  private staffListView(t: Prisma.SupportTicketGetPayload<{ include: typeof ticketInclude }>) {
    return {
      id: t.id, code: t.code, subject: t.subject, status: t.status, priority: t.priority, app: t.app,
      category: t.category, user: { id: t.user.id, name: t.user.name, phone: t.user.phone, email: t.user.email }, assignee: t.assignee,
      unread: t.conversation.otherUnread, lastMessageText: t.conversation.lastMessageText, lastMessageAt: t.conversation.lastMessageAt,
      firstResponseAt: t.firstResponseAt, createdAt: t.createdAt, updatedAt: t.updatedAt,
    };
  }

  async summary(actor: Principal) {
    const count = (where: Prisma.SupportTicketWhereInput) => this.prisma.supportTicket.count({ where });
    const [open, unassigned, mine, waiting, needsReply, urgent] = await Promise.all([
      count({ status: 'OPEN' }),
      count({ status: { in: ACTIVE }, assigneeId: null }),
      count({ status: { in: ACTIVE }, assigneeId: actor.userId }),
      count({ status: 'WAITING' }),
      count({ status: { in: ACTIVE }, conversation: { otherUnread: { gt: 0 } } }),
      count({ status: { in: ACTIVE }, priority: 'URGENT' }),
    ]);
    return { open, unassigned, mine, waiting, needsReply, urgent };
  }

  /** Opening a ticket marks the person's messages as seen by support. */
  async adminDetail(actor: Principal, id: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, include: ticketInclude });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (t.conversation.otherUnread > 0) {
      const at = new Date();
      await this.prisma.conversation.update({ where: { id: t.conversationId }, data: { otherUnread: 0, otherReadAt: at } });
      this.realtime.publish([t.userId], { type: 'read', conversationId: t.conversationId, side: 'STAFF', at: at.toISOString() });
    }
    const [partner, vendor, others, ref] = await Promise.all([
      this.prisma.servicePartner.findUnique({ where: { userId: t.userId }, select: { id: true, businessName: true, status: true } }),
      this.prisma.vendor.findUnique({ where: { userId: t.userId }, select: { id: true, businessName: true, status: true } }),
      this.prisma.supportTicket.findMany({ where: { userId: t.userId, id: { not: t.id } }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, code: true, subject: true, status: true, createdAt: true } }),
      this.refSummary(t.refType, t.refId),
    ]);
    return {
      ...this.staffListView(t),
      user: { ...t.user, partner, vendor },
      ref,
      otherTickets: others,
      resolvedAt: t.resolvedAt, closedAt: t.closedAt,
      seenByPersonAt: t.conversation.customerReadAt,
      canReply: t.status !== 'CLOSED' && this.canManage(actor),
    };
  }

  private async refSummary(type: string | null, id: string | null) {
    if (!type || !id) return null;
    if (type === 'BOOKING') {
      const b = await this.prisma.booking.findUnique({ where: { id }, select: { id: true, code: true, status: true, startsAt: true, pricePaise: true, partner: { select: { businessName: true } } } });
      return b ? { type, id, code: b.code, status: b.status, startsAt: b.startsAt, amountPaise: b.pricePaise, business: b.partner.businessName } : null;
    }
    const s = await this.prisma.subOrder.findUnique({ where: { id }, select: { id: true, code: true, status: true, totalPaise: true, order: { select: { id: true } }, vendor: { select: { businessName: true } } } });
    return s ? { type, id, code: s.code, status: s.status, amountPaise: s.totalPaise, orderId: s.order.id, business: s.vendor.businessName } : null;
  }

  adminMessages(id: string, q: MessagesQuery) {
    return this.prisma.supportTicket.findUnique({ where: { id }, select: { conversationId: true } }).then((t) => {
      if (!t) throw new NotFoundException('Ticket not found.');
      return this.chat.page(t.conversationId, q, { side: 'STAFF', staff: true });
    });
  }

  async reply(actor: Principal, id: string, dto: StaffReplyDto, meta: RequestMetaInfo) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (t.status === 'CLOSED') throw new ConflictException('This ticket is closed. The person can open a new one.');
    const internal = dto.internal === true;
    // A reply moves a new ticket to In progress; "reply and mark waiting/resolved" moves it on from there.
    const base = afterStaffReply(t.status);
    const next: TicketStatus = internal ? t.status : (dto.status ?? base);
    if (!internal && next !== base && !staffCanMove(base, next) && !staffCanMove(t.status, next)) {
      throw new BadRequestException(`A ticket can’t go from ${TICKET_STATUS_LABEL[t.status]} to ${TICKET_STATUS_LABEL[next]}.`);
    }

    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({ data: { conversationId: t.conversationId, senderId: actor.userId, side: 'STAFF', body: dto.body, internal } });
      if (!internal) {
        await tx.conversation.update({
          where: { id: t.conversationId },
          data: { lastMessageAt: m.createdAt, lastMessageText: previewOf({ body: dto.body }), customerUnread: { increment: 1 }, otherUnread: 0, otherReadAt: m.createdAt },
        });
      }
      await tx.supportTicket.update({
        where: { id },
        data: {
          status: next,
          ...(internal ? {} : { firstResponseAt: t.firstResponseAt ?? m.createdAt }),
          ...(t.assigneeId ? {} : { assigneeId: actor.userId }),
          ...(next === 'RESOLVED' && t.status !== 'RESOLVED' ? { resolvedAt: m.createdAt } : {}),
        },
      });
      await this.audit.log({ actorId: actor.userId, action: internal ? 'support.note' : 'support.reply', entityType: 'SupportTicket', entityId: id, before: { status: t.status }, after: { status: next, messageId: m.id }, meta }, tx);
      return m;
    });

    if (!internal) {
      const full = await this.prisma.chatMessage.findUniqueOrThrow({ where: { id: msg.id }, include: { media: true, sender: { select: { name: true } } } });
      const [neutral] = await this.chat.views([full], { side: null });
      this.realtime.publish([t.userId], { type: 'message', conversationId: t.conversationId, message: neutral });
      this.queue.notify({ type: 'SUPPORT_UPDATE', ticketId: id, messageId: msg.id });
    }
    return this.adminDetail(actor, id);
  }

  async update(actor: Principal, id: string, dto: UpdateTicketDto, meta: RequestMetaInfo) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (t.status === 'CLOSED' && (dto.status || dto.assigneeId !== undefined)) throw new ConflictException('This ticket is closed.');
    const data: Prisma.SupportTicketUncheckedUpdateInput = {};
    if (dto.priority) data.priority = dto.priority;
    if (dto.categoryId) {
      if (!(await this.prisma.supportCategory.count({ where: { id: dto.categoryId } }))) throw new BadRequestException('Unknown category.');
      data.categoryId = dto.categoryId;
    }
    let status = t.status;
    if (dto.assigneeId !== undefined) {
      if (dto.assigneeId && !(await this.isSupportStaff(dto.assigneeId))) throw new BadRequestException('Tickets can only be assigned to staff who handle support.');
      data.assigneeId = dto.assigneeId;
      if (dto.assigneeId && t.status === 'OPEN' && !dto.status) status = 'ASSIGNED';
      if (!dto.assigneeId && t.status === 'ASSIGNED' && !dto.status) status = 'OPEN';
    }
    if (dto.status && dto.status !== t.status) {
      if (!staffCanMove(t.status, dto.status)) throw new BadRequestException(`A ticket can’t go from ${TICKET_STATUS_LABEL[t.status]} to ${TICKET_STATUS_LABEL[dto.status]}.`);
      status = dto.status;
    }
    if (Object.keys(data).length) await this.prisma.supportTicket.update({ where: { id }, data });
    if (status !== t.status) await this.setStatus(id, t.status, status, actor.userId);
    await this.audit.log({ actorId: actor.userId, action: 'support.update', entityType: 'SupportTicket', entityId: id, before: { status: t.status, priority: t.priority, assigneeId: t.assigneeId, categoryId: t.categoryId }, after: { ...dto, status }, meta });
    return this.adminDetail(actor, id);
  }

  /** Changes the status and tells the person, with a line in the thread for the changes that matter to them. */
  private async setStatus(id: string, from: TicketStatus, to: TicketStatus, actorId: string | null, note?: string) {
    const t = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const t = await tx.supportTicket.update({
        where: { id },
        data: { status: to, ...(to === 'RESOLVED' ? { resolvedAt: now } : {}), ...(to === 'CLOSED' ? { closedAt: now } : {}), ...(from === 'RESOLVED' && to !== 'CLOSED' ? { resolvedAt: null } : {}) },
      });
      if (to === 'CLOSED') await tx.conversation.update({ where: { id: t.conversationId }, data: { status: 'CLOSED' } });
      const visible = to === 'WAITING' || to === 'RESOLVED' || to === 'CLOSED' || (from === 'RESOLVED' && to === 'IN_PROGRESS');
      if (visible) {
        const body = note ?? (to === 'WAITING' ? 'Support is waiting for your reply.' : to === 'RESOLVED' ? 'Support marked this ticket as resolved. Reply if you still need help.' : to === 'CLOSED' ? 'This ticket is closed.' : 'Support reopened this ticket.');
        const m = await tx.chatMessage.create({ data: { conversationId: t.conversationId, side: 'SYSTEM', body } });
        await tx.conversation.update({ where: { id: t.conversationId }, data: { lastMessageAt: m.createdAt, lastMessageText: body, ...(actorId ? { customerUnread: { increment: 1 } } : {}) } });
      }
      return t;
    });
    this.realtime.publish([t.userId], { type: 'conversation', conversationId: t.conversationId, status: to });
    if (actorId && (to === 'WAITING' || to === 'RESOLVED' || to === 'CLOSED')) this.queue.notify({ type: 'SUPPORT_UPDATE', ticketId: id, status: to });
  }

  /** Admin ↔ person: staff start a conversation, as a ticket the person can answer from the app. */
  async staffStart(actor: Principal, dto: StaffStartTicketDto, meta: RequestMetaInfo) {
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, deletedAt: null, status: { notIn: ['DELETED'] } }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found.');
    if (!(await this.prisma.supportCategory.count({ where: { id: dto.categoryId } }))) throw new BadRequestException('Unknown category.');
    const ticket = await this.withCode((code) =>
      this.prisma.$transaction(async (tx) => {
        const conv = await tx.conversation.create({ data: { kind: 'SUPPORT', customerId: user.id } });
        const now = new Date();
        const t = await tx.supportTicket.create({
          data: { code, userId: user.id, categoryId: dto.categoryId, subject: dto.subject, conversationId: conv.id, app: 'STAFF', status: 'IN_PROGRESS', assigneeId: actor.userId, createdById: actor.userId, firstResponseAt: now },
        });
        const m = await tx.chatMessage.create({ data: { conversationId: conv.id, senderId: actor.userId, side: 'STAFF', body: dto.body } });
        await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: m.createdAt, lastMessageText: previewOf({ body: dto.body }), customerUnread: 1, otherReadAt: m.createdAt } });
        await this.audit.log({ actorId: actor.userId, action: 'support.start', entityType: 'SupportTicket', entityId: t.id, after: { userId: user.id, subject: dto.subject }, meta }, tx);
        return { ticket: t, messageId: m.id };
      }),
    );
    this.queue.notify({ type: 'SUPPORT_UPDATE', ticketId: ticket.ticket.id, messageId: ticket.messageId });
    return this.adminDetail(actor, ticket.ticket.id);
  }

  /** Staff who can be given tickets: anyone allowed to manage support. */
  async assignees() {
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE', roles: { some: { role: { OR: [{ key: 'SUPER_ADMIN' }, { permissions: { some: { permission: { key: PERMISSIONS.SUPPORT_MANAGE } } } }] } } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return rows;
  }

  private async isSupportStaff(userId: string) {
    const a = await this.rbac.getAccess(userId);
    return !!a && a.status === 'ACTIVE' && a.isStaff && (a.roles.includes('SUPER_ADMIN') || a.permissions.includes(PERMISSIONS.SUPPORT_MANAGE));
  }

  private canManage(actor: Principal) {
    return actor.isSuperAdmin || actor.permissions.includes(PERMISSIONS.SUPPORT_MANAGE);
  }

  private async withCode<T>(fn: (code: string) => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn(ticketCode());
      } catch (e) {
        const target = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' ? String((e.meta as { target?: unknown })?.target ?? '') : '';
        if (i < 4 && target.includes('code')) continue;
        throw e;
      }
    }
  }

  // ───────────── FAQs and categories (staff) ─────────────

  adminFaqs() {
    return this.prisma.supportFaq.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { category: { select: { id: true, name: true } } } });
  }

  async createFaq(actor: Principal, dto: FaqDto, meta: RequestMetaInfo) {
    const f = await this.prisma.supportFaq.create({ data: { question: dto.question, answer: dto.answer, categoryId: dto.categoryId ?? null, audience: dto.audience ?? 'ALL', sortOrder: dto.sortOrder ?? 0, published: dto.published ?? false } });
    await this.audit.log({ actorId: actor.userId, action: 'support.faq.create', entityType: 'SupportFaq', entityId: f.id, after: { question: f.question, published: f.published }, meta });
    return f;
  }

  async updateFaq(actor: Principal, id: string, dto: UpdateFaqDto, meta: RequestMetaInfo) {
    const before = await this.prisma.supportFaq.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Question not found.');
    const f = await this.prisma.supportFaq.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: actor.userId, action: 'support.faq.update', entityType: 'SupportFaq', entityId: id, before: { question: before.question, published: before.published }, after: dto, meta });
    return f;
  }

  async deleteFaq(actor: Principal, id: string, meta: RequestMetaInfo) {
    const f = await this.prisma.supportFaq.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Question not found.');
    await this.prisma.supportFaq.delete({ where: { id } });
    await this.audit.log({ actorId: actor.userId, action: 'support.faq.delete', entityType: 'SupportFaq', entityId: id, before: { question: f.question }, meta });
    return { deleted: true };
  }

  adminCategories() {
    return this.prisma.supportCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { tickets: true, faqs: true } } } });
  }

  async createCategory(actor: Principal, dto: CategoryDto, meta: RequestMetaInfo) {
    try {
      const c = await this.prisma.supportCategory.create({ data: { key: dto.key, name: dto.name, audience: dto.audience ?? 'ALL', sortOrder: dto.sortOrder ?? 0 } });
      await this.audit.log({ actorId: actor.userId, action: 'support.category.create', entityType: 'SupportCategory', entityId: c.id, after: dto, meta });
      return c;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A category with this key already exists.');
      throw e;
    }
  }

  async updateCategory(actor: Principal, id: string, dto: UpdateCategoryDto, meta: RequestMetaInfo) {
    if (!(await this.prisma.supportCategory.count({ where: { id } }))) throw new NotFoundException('Category not found.');
    const c = await this.prisma.supportCategory.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: actor.userId, action: 'support.category.update', entityType: 'SupportCategory', entityId: id, after: dto, meta });
    return c;
  }
}
