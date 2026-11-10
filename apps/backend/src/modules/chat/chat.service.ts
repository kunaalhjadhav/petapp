import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { ChatMessage, MediaAsset } from '../../generated/prisma/client';
import type { ChatSide, ConversationKind, TicketStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../../providers/storage/storage.service';
import { QueueService } from '../../queue/queue.service';
import { MediaService } from '../media/media.service';
import { PlatformService } from '../platform/platform.service';
import { SafetyService } from '../safety/safety.service';
import { decodeCursor, encodeCursor } from '../posts/text';
import { ChatRealtime } from './chat.realtime';
import { afterCustomerReply, previewOf, sideOf } from './chat.rules';
import type { ListConversationsQuery, MessagesQuery, SendMessageDto, StartConversationDto } from './chat.dto';

const convInclude = {
  partner: { select: { id: true, userId: true, slug: true, businessName: true, status: true, city: true } },
  vendor: { select: { id: true, userId: true, slug: true, businessName: true, status: true, city: true } },
  customer: { select: { id: true, name: true, avatarUrl: true, status: true, deletedAt: true } },
  ticket: { select: { id: true, code: true, status: true, subject: true } },
} satisfies Prisma.ConversationInclude;
export type LoadedConversation = Prisma.ConversationGetPayload<{ include: typeof convInclude }>;

/** Who is looking: a side of the conversation, staff, or nobody in particular (live events). */
export type Viewer = { side: ChatSide | null; staff?: boolean };
type MessageRow = ChatMessage & { media: MediaAsset | null; sender?: { name: string | null } | null };

/**
 * In-app messaging (spec §37): customer ↔ service partner, customer ↔ seller, and each support ticket's thread.
 * Messages are sent over HTTP (validated, idempotent) and delivered live over the WebSocket; push reaches people who
 * aren't in the app. Nobody outside a conversation can read it: staff see private chats only when a message is
 * reported to moderation.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly safety: SafetyService,
    private readonly queue: QueueService,
    private readonly realtime: ChatRealtime,
    private readonly redis: RedisService,
  ) {}

  // ───────────── conversations ─────────────

  async list(userId: string, q: ListConversationsQuery) {
    if (!(await this.platform.isEnabled('ENABLE_CHAT'))) return { items: [], nextCursor: null };
    const c = decodeCursor(q.cursor);
    const base: Prisma.ConversationWhereInput =
      q.as === 'customer' ? { customerId: userId, kind: { in: ['SERVICE', 'SHOP'] } }
      : q.as === 'partner' ? { kind: 'SERVICE', partner: { userId } }
      : { kind: 'SHOP', vendor: { userId } };
    const rows = await this.prisma.conversation.findMany({
      where: {
        ...base,
        lastMessageAt: c ? undefined : { not: null },
        ...(c ? { OR: [{ lastMessageAt: { lt: c.date } }, { lastMessageAt: c.date, id: { lt: c.id } }] } : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: convInclude,
    });
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const blocked = await this.blockedPairs(userId, page.map((r) => this.counterpartUserId(r, q.as === 'customer' ? 'CUSTOMER' : 'BUSINESS')));
    return {
      items: page.map((r) => {
        const side = q.as === 'customer' ? 'CUSTOMER' : 'BUSINESS';
        return {
          id: r.id, kind: r.kind, status: r.status, counterpart: this.counterpart(r, side),
          lastMessageText: r.lastMessageText, lastMessageAt: r.lastMessageAt,
          unread: side === 'CUSTOMER' ? r.customerUnread : r.otherUnread,
          blocked: blocked.has(this.counterpartUserId(r, side) ?? ''),
        };
      }),
      nextCursor: more ? encodeCursor(page[page.length - 1].lastMessageAt!, page[page.length - 1].id) : null,
    };
  }

  /** Unread counts for the badges in each app. */
  async unread(userId: string) {
    const sum = async (where: Prisma.ConversationWhereInput, field: 'customerUnread' | 'otherUnread') =>
      (await this.prisma.conversation.aggregate({ where, _sum: { [field]: true } }))._sum[field] ?? 0;
    const chat = await this.platform.isEnabled('ENABLE_CHAT');
    return {
      customer: chat ? await sum({ customerId: userId, kind: { in: ['SERVICE', 'SHOP'] } }, 'customerUnread') : 0,
      partner: chat ? await sum({ kind: 'SERVICE', partner: { userId } }, 'otherUnread') : 0,
      seller: chat ? await sum({ kind: 'SHOP', vendor: { userId } }, 'otherUnread') : 0,
      support: await sum({ customerId: userId, kind: 'SUPPORT' }, 'customerUnread'),
    };
  }

  /** Opens the conversation for a partner, product, booking or order, creating it the first time. */
  async start(userId: string, dto: StartConversationDto) {
    const given = [dto.partnerId, dto.productId, dto.bookingId, dto.subOrderId].filter(Boolean).length;
    if (given !== 1) throw new BadRequestException('Say who the conversation is with: a partner, a product, a booking or an order.');
    await this.requireChat();

    let kind: ConversationKind;
    let customerId: string;
    let partnerId: string | null = null;
    let vendorId: string | null = null;
    let businessUserId: string;
    let context: { refType: 'BOOKING' | 'PRODUCT' | 'ORDER'; refId: string } | null = null;

    if (dto.partnerId) {
      if (!(await this.platform.isEnabled('ENABLE_SERVICES'))) throw new NotFoundException('This feature isn’t available right now.');
      const p = await this.prisma.servicePartner.findFirst({ where: { id: dto.partnerId, status: 'APPROVED' }, select: { id: true, userId: true } });
      if (!p) throw new NotFoundException('Partner not found.');
      [kind, customerId, partnerId, businessUserId] = ['SERVICE', userId, p.id, p.userId];
    } else if (dto.productId) {
      if (!(await this.platform.isEnabled('ENABLE_MARKETPLACE'))) throw new NotFoundException('This feature isn’t available right now.');
      const p = await this.prisma.product.findFirst({ where: { id: dto.productId, status: 'ACTIVE', vendor: { status: 'APPROVED' } }, select: { id: true, vendor: { select: { id: true, userId: true } } } });
      if (!p) throw new NotFoundException('Product not found.');
      [kind, customerId, vendorId, businessUserId] = ['SHOP', userId, p.vendor.id, p.vendor.userId];
      context = { refType: 'PRODUCT', refId: p.id };
    } else if (dto.bookingId) {
      const b = await this.prisma.booking.findUnique({ where: { id: dto.bookingId }, select: { id: true, customerId: true, partnerId: true, partner: { select: { userId: true } } } });
      if (!b || (b.customerId !== userId && b.partner.userId !== userId)) throw new NotFoundException('Booking not found.');
      [kind, customerId, partnerId, businessUserId] = ['SERVICE', b.customerId, b.partnerId, b.partner.userId];
      context = { refType: 'BOOKING', refId: b.id };
    } else {
      const s = await this.prisma.subOrder.findUnique({ where: { id: dto.subOrderId! }, select: { id: true, vendorId: true, vendor: { select: { userId: true } }, order: { select: { userId: true } } } });
      if (!s || (s.order.userId !== userId && s.vendor.userId !== userId)) throw new NotFoundException('Order not found.');
      [kind, customerId, vendorId, businessUserId] = ['SHOP', s.order.userId, s.vendorId, s.vendor.userId];
      context = { refType: 'ORDER', refId: s.id };
    }
    if (customerId === businessUserId) throw new BadRequestException('You can’t message your own business.');
    if (await this.safety.isBlockedEitherWay(customerId, businessUserId)) throw new ForbiddenException('You can’t message this account.');

    const unique = kind === 'SERVICE'
      ? { kind_customerId_partnerId: { kind, customerId, partnerId: partnerId! } }
      : { kind_customerId_vendorId: { kind, customerId, vendorId: vendorId! } };
    let conv = await this.prisma.conversation.findUnique({ where: unique as Prisma.ConversationWhereUniqueInput, include: convInclude });
    if (!conv) {
      // Limits cold messages to businesses: new conversations a person can start per day.
      if (customerId === userId) {
        const limit = await this.platform.getSetting<number>('chat.newConversationsPerDay');
        const today = await this.prisma.conversation.count({ where: { customerId: userId, kind: { in: ['SERVICE', 'SHOP'] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
        if (today >= limit) throw new HttpException('You’ve started a lot of new conversations today. Try again tomorrow.', HttpStatus.TOO_MANY_REQUESTS);
      }
      try {
        conv = await this.prisma.conversation.create({ data: { kind, customerId, partnerId, vendorId }, include: convInclude });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        conv = await this.prisma.conversation.findUniqueOrThrow({ where: unique as Prisma.ConversationWhereUniqueInput, include: convInclude });
      }
    }
    return { conversation: await this.header(conv, conv.customerId === userId ? 'CUSTOMER' : 'BUSINESS', userId), context };
  }

  async get(userId: string, id: string) {
    const { conv, side } = await this.member(userId, id);
    return this.header(conv, side, userId);
  }

  /** The conversation and the caller's side. Anyone else gets 404, so ids can't be probed. */
  async member(userId: string, id: string): Promise<{ conv: LoadedConversation; side: 'CUSTOMER' | 'BUSINESS' }> {
    const conv = await this.prisma.conversation.findUnique({ where: { id }, include: convInclude });
    const side = conv ? sideOf(conv, userId) : null;
    if (!conv || !side) throw new NotFoundException('Conversation not found.');
    if (conv.kind !== 'SUPPORT' && !(await this.platform.isEnabled('ENABLE_CHAT'))) throw new NotFoundException('This feature isn’t available right now.');
    return { conv, side };
  }

  private async header(conv: LoadedConversation, side: 'CUSTOMER' | 'BUSINESS', userId: string) {
    const other = this.counterpartUserId(conv, side);
    const [blockedByMe, blockedMe] = other
      ? await Promise.all([
          this.prisma.block.count({ where: { blockerId: userId, blockedId: other } }),
          this.prisma.block.count({ where: { blockerId: other, blockedId: userId } }),
        ])
      : [0, 0];
    const cannot = this.cannotSend(conv, side, blockedByMe > 0, blockedMe > 0);
    return {
      id: conv.id, kind: conv.kind, status: conv.status, side,
      counterpart: this.counterpart(conv, side),
      canSend: !cannot, cannotSendReason: cannot,
      blockedByMe: blockedByMe > 0,
      unread: side === 'CUSTOMER' ? conv.customerUnread : conv.otherUnread,
      /** When the other side last read: messages up to here show as read. */
      otherReadAt: side === 'CUSTOMER' ? conv.otherReadAt : conv.customerReadAt,
      ticket: conv.ticket ? { id: conv.ticket.id, code: conv.ticket.code, status: conv.ticket.status, subject: conv.ticket.subject } : null,
    };
  }

  private cannotSend(conv: LoadedConversation, side: 'CUSTOMER' | 'BUSINESS', blockedByMe: boolean, blockedMe: boolean): string | null {
    if (conv.kind === 'SUPPORT') {
      return conv.ticket?.status === 'CLOSED' || conv.status === 'CLOSED' ? 'This ticket is closed. Open a new one if you still need help.' : null;
    }
    if (conv.status === 'CLOSED') return 'This conversation has been closed.';
    if (blockedByMe) return 'You blocked this account. Unblock it to send messages.';
    if (blockedMe) return 'You can’t reply to this conversation.';
    const business = conv.partner ?? conv.vendor;
    if (side === 'CUSTOMER' && business?.status !== 'APPROVED') return 'This business isn’t taking messages on PetApp right now.';
    if (side === 'BUSINESS' && (conv.customer.status !== 'ACTIVE' || conv.customer.deletedAt)) return 'This person’s account isn’t active.';
    return null;
  }

  private counterpart(conv: LoadedConversation, side: 'CUSTOMER' | 'BUSINESS') {
    if (conv.kind === 'SUPPORT') return { type: 'SUPPORT' as const, name: 'PetApp Support', avatarUrl: null };
    if (side === 'BUSINESS') {
      const gone = conv.customer.deletedAt || conv.customer.status === 'DELETED';
      return { type: 'CUSTOMER' as const, name: gone ? 'Deleted account' : conv.customer.name?.trim() || 'PetApp user', avatarUrl: gone ? null : conv.customer.avatarUrl };
    }
    if (conv.partner) return { type: 'PARTNER' as const, id: conv.partner.id, slug: conv.partner.slug, name: conv.partner.businessName, city: conv.partner.city, avatarUrl: null };
    return { type: 'SELLER' as const, id: conv.vendor!.id, slug: conv.vendor!.slug, name: conv.vendor!.businessName, city: conv.vendor!.city, avatarUrl: null };
  }

  private counterpartUserId(conv: LoadedConversation, side: 'CUSTOMER' | 'BUSINESS'): string | null {
    if (conv.kind === 'SUPPORT') return null;
    return side === 'CUSTOMER' ? (conv.partner?.userId ?? conv.vendor?.userId ?? null) : conv.customerId;
  }

  /** Everyone whose apps show this conversation (both sides, so the sender's other devices update too). */
  recipients(conv: LoadedConversation): string[] {
    return [conv.customerId, conv.partner?.userId, conv.vendor?.userId].filter((x): x is string => !!x);
  }

  private async blockedPairs(me: string, others: Array<string | null>): Promise<Set<string>> {
    const ids = others.filter((x): x is string => !!x);
    if (!ids.length) return new Set();
    const rows = await this.prisma.block.findMany({ where: { OR: [{ blockerId: me, blockedId: { in: ids } }, { blockedId: me, blockerId: { in: ids } }] }, select: { blockerId: true, blockedId: true } });
    return new Set(rows.map((r) => (r.blockerId === me ? r.blockedId : r.blockerId)));
  }

  // ───────────── messages ─────────────

  async messages(userId: string, id: string, q: MessagesQuery) {
    const { conv, side } = await this.member(userId, id);
    return this.page(conv.id, q, { side });
  }

  /** A page of messages. `before`: newest first, going back. `after`: oldest first, catching up. Staff notes only for staff. */
  async page(conversationId: string, q: MessagesQuery, viewer: Viewer) {
    const after = decodeCursor(q.after);
    const before = decodeCursor(q.before);
    const where: Prisma.ChatMessageWhereInput = {
      conversationId,
      ...(viewer.staff ? {} : { internal: false }),
      ...(after ? { OR: [{ createdAt: { gt: after.date } }, { createdAt: after.date, id: { gt: after.id } }] } : {}),
      ...(before ? { OR: [{ createdAt: { lt: before.date } }, { createdAt: before.date, id: { lt: before.id } }] } : {}),
    };
    const rows = await this.prisma.chatMessage.findMany({
      where,
      orderBy: after ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: { media: true, sender: { select: { name: true } } },
    });
    const more = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    const views = await this.views(items, viewer);
    const last = items[items.length - 1];
    return {
      items: views,
      /** after: pass as `after` again while `more` is true. before: pass as `before` to load older messages. */
      nextCursor: more && last ? encodeCursor(last.createdAt, last.id) : null,
      more,
    };
  }

  async send(userId: string, id: string, dto: SendMessageDto) {
    const { conv, side } = await this.member(userId, id);
    if (!dto.body && !dto.mediaId && !dto.refType) throw new BadRequestException('Write a message, or attach a photo or a card.');
    if (!!dto.refType !== !!dto.refId) throw new BadRequestException('A card needs both its type and its id.');
    if (dto.clientId) {
      const prev = await this.prisma.chatMessage.findUnique({ where: { senderId_clientId: { senderId: userId, clientId: dto.clientId } }, include: { media: true, sender: { select: { name: true } } } });
      if (prev) {
        if (prev.conversationId !== conv.id) throw new ConflictException('This message id was already used.');
        return (await this.views([prev], { side }))[0];
      }
    }

    const other = this.counterpartUserId(conv, side);
    const [blockedByMe, blockedMe] = other
      ? await Promise.all([this.prisma.block.count({ where: { blockerId: userId, blockedId: other } }), this.prisma.block.count({ where: { blockerId: other, blockedId: userId } })])
      : [0, 0];
    const cannot = this.cannotSend(conv, side, blockedByMe > 0, blockedMe > 0);
    if (cannot) throw new ForbiddenException(cannot);

    let nextTicketStatus: TicketStatus | null = null;
    if (conv.kind === 'SUPPORT') {
      nextTicketStatus = afterCustomerReply(conv.ticket!.status);
      if (!nextTicketStatus) throw new ForbiddenException('This ticket is closed. Open a new one if you still need help.');
    }
    await this.rateLimit(userId);
    const media = dto.mediaId ? await this.attachable(userId, dto.mediaId, conv.kind === 'SUPPORT') : null;
    if (dto.refType) await this.checkRef(conv, side, userId, dto.refType, dto.refId!);

    const preview = previewOf({ body: dto.body ?? null, mediaKind: media?.kind, refType: dto.refType });
    let msg: MessageRow;
    try {
      msg = await this.prisma.$transaction(async (tx) => {
        const m = await tx.chatMessage.create({
          data: { conversationId: conv.id, senderId: userId, side, body: dto.body || null, mediaId: media?.id ?? null, refType: dto.refType ?? null, refId: dto.refId ?? null, clientId: dto.clientId ?? null },
          include: { media: true, sender: { select: { name: true } } },
        });
        const now = m.createdAt;
        await tx.conversation.update({
          where: { id: conv.id },
          data: side === 'CUSTOMER'
            ? { lastMessageAt: now, lastMessageText: preview, otherUnread: { increment: 1 }, customerUnread: 0, customerReadAt: now }
            : { lastMessageAt: now, lastMessageText: preview, customerUnread: { increment: 1 }, otherUnread: 0, otherReadAt: now },
        });
        if (conv.ticket && nextTicketStatus && nextTicketStatus !== conv.ticket.status) {
          await tx.supportTicket.update({ where: { id: conv.ticket.id }, data: { status: nextTicketStatus, resolvedAt: null } });
        } else if (conv.ticket) {
          await tx.supportTicket.update({ where: { id: conv.ticket.id }, data: { updatedAt: now } });
        }
        return m;
      });
    } catch (e) {
      // The same clientId sent twice at once: return the one that won.
      if (dto.clientId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const prev = await this.prisma.chatMessage.findUniqueOrThrow({ where: { senderId_clientId: { senderId: userId, clientId: dto.clientId } }, include: { media: true, sender: { select: { name: true } } } });
        return (await this.views([prev], { side }))[0];
      }
      throw e;
    }

    const neutral = (await this.views([msg], { side: null }))[0];
    this.realtime.publish(this.recipients(conv), { type: 'message', conversationId: conv.id, message: neutral });
    if (conv.kind !== 'SUPPORT') this.queue.notify({ type: 'CHAT_MESSAGE', messageId: msg.id });
    if ((msg.body || msg.mediaId) && (await this.platform.getSetting<boolean>('chat.aiCheck'))) this.queue.assess('CHAT_MESSAGE', msg.id);
    return (await this.views([msg], { side }))[0];
  }

  async markRead(userId: string, id: string) {
    const { conv, side } = await this.member(userId, id);
    const at = new Date();
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: side === 'CUSTOMER' ? { customerUnread: 0, customerReadAt: at } : { otherUnread: 0, otherReadAt: at },
    });
    this.realtime.publish(this.recipients(conv), { type: 'read', conversationId: conv.id, side, at: at.toISOString() });
    return { read: true, at };
  }

  async block(userId: string, id: string, on: boolean) {
    const { conv, side } = await this.member(userId, id);
    const other = this.counterpartUserId(conv, side);
    if (!other) throw new BadRequestException('Support conversations can’t be blocked.');
    if (on) await this.safety.block(userId, other);
    else await this.safety.unblock(userId, other);
    return this.header(conv, side, userId);
  }

  /** For the WebSocket: may this person signal typing here, and to whom? */
  async typingTargets(userId: string, conversationId: string): Promise<{ side: 'CUSTOMER' | 'BUSINESS'; to: string[] } | null> {
    try {
      const { conv, side } = await this.member(userId, conversationId);
      if (conv.kind === 'SUPPORT') return null;
      return { side, to: this.recipients(conv).filter((u) => u !== userId) };
    } catch {
      return null;
    }
  }

  // ───────────── helpers ─────────────

  private async requireChat() {
    if (!(await this.platform.isEnabled('ENABLE_CHAT'))) throw new NotFoundException('This feature isn’t available right now.');
  }

  private async rateLimit(userId: string) {
    const max = await this.platform.getSetting<number>('chat.maxMessagesPerMinute');
    const key = `chat:rate:${userId}:${Math.floor(Date.now() / 60_000)}`;
    const n = await this.redis.client.incr(key);
    if (n === 1) await this.redis.client.expire(key, 70);
    if (n > max) throw new HttpException('You’re sending messages very quickly. Wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** A photo the sender uploaded privately (or, in support, a PDF), processed and ready. */
  async attachable(userId: string, mediaId: string, support: boolean): Promise<MediaAsset> {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id: mediaId, ownerId: userId } });
    if (!m) throw new NotFoundException('Upload not found.');
    const okKind = (m.kind === 'IMAGE' && m.private) || (support && m.kind === 'DOCUMENT');
    if (!okKind) throw new BadRequestException(support ? 'Attach a photo or a PDF uploaded for this ticket.' : 'Attach a photo uploaded for this chat.');
    if (m.status !== 'READY') throw new ConflictException(m.status === 'REJECTED' || m.status === 'FAILED' ? 'This file couldn’t be used. Try another.' : 'The photo is still being prepared. Try again in a moment.');
    return m;
  }

  /** A card must be something both sides of this conversation share. */
  private async checkRef(conv: LoadedConversation, side: 'CUSTOMER' | 'BUSINESS', userId: string, type: 'BOOKING' | 'PRODUCT' | 'ORDER', refId: string) {
    const nf = () => new NotFoundException('That card can’t be shared here.');
    if (conv.kind === 'SUPPORT') {
      if (type === 'PRODUCT') throw nf();
      if (type === 'BOOKING') {
        const ok = await this.prisma.booking.count({ where: { id: refId, OR: [{ customerId: userId }, { partner: { userId } }] } });
        if (!ok) throw nf();
      } else {
        const ok = await this.prisma.subOrder.count({ where: { id: refId, OR: [{ order: { userId } }, { vendor: { userId } }] } });
        if (!ok) throw nf();
      }
      return;
    }
    if (type === 'BOOKING') {
      if (conv.kind !== 'SERVICE' || !(await this.prisma.booking.count({ where: { id: refId, customerId: conv.customerId, partnerId: conv.partnerId! } }))) throw nf();
    } else if (type === 'ORDER') {
      if (conv.kind !== 'SHOP' || !(await this.prisma.subOrder.count({ where: { id: refId, vendorId: conv.vendorId!, order: { userId: conv.customerId } } }))) throw nf();
    } else {
      const where: Prisma.ProductWhereInput = { id: refId, vendorId: conv.vendorId ?? '00000000-0000-0000-0000-000000000000', status: side === 'CUSTOMER' ? 'ACTIVE' : { not: 'BLOCKED' } };
      if (conv.kind !== 'SHOP' || !(await this.prisma.product.count({ where }))) throw nf();
    }
  }

  /** Client-facing messages: removed ones keep their place but not their content. */
  async views(rows: MessageRow[], viewer: Viewer) {
    const refs = await this.loadRefs(rows.filter((r) => r.status === 'VISIBLE'));
    return Promise.all(
      rows.map(async (m) => {
        const visible = m.status === 'VISIBLE';
        return {
          id: m.id,
          conversationId: m.conversationId,
          side: m.side,
          mine: viewer.staff ? m.side === 'STAFF' : viewer.side !== null && m.side !== 'SYSTEM' && viewer.side === m.side,
          /** Staff are shown by first name; people never see staff surnames. */
          senderName: m.side === 'STAFF' ? (m.sender?.name?.trim().split(/\s+/)[0] ?? 'PetApp Support') : undefined,
          body: visible ? m.body : null,
          removed: !visible,
          internal: m.internal || undefined,
          media: visible && m.media ? await this.attachmentView(m.media) : null,
          ref: visible && m.refType && m.refId ? (refs.get(`${m.refType}:${m.refId}`) ?? { type: m.refType, id: m.refId, unavailable: true }) : null,
          clientId: m.clientId,
          createdAt: m.createdAt,
        };
      }),
    );
  }

  private async attachmentView(m: MediaAsset) {
    if (m.kind === 'DOCUMENT') {
      return { id: m.id, kind: 'DOCUMENT' as const, status: m.status, mimeType: m.mimeType, sizeBytes: m.sizeBytes, url: m.status === 'READY' ? await this.storage.privateDocumentUrl(m.storageKey, 900) : null };
    }
    return this.media.view(m);
  }

  private async loadRefs(rows: MessageRow[]) {
    const ids = (t: string) => [...new Set(rows.filter((r) => r.refType === t && r.refId).map((r) => r.refId!))];
    const out = new Map<string, unknown>();
    const [bookings, products, subOrders] = await Promise.all([
      ids('BOOKING').length ? this.prisma.booking.findMany({ where: { id: { in: ids('BOOKING') } }, include: { service: { select: { name: true } }, pet: { select: { name: true } } } }) : [],
      ids('PRODUCT').length ? this.prisma.product.findMany({ where: { id: { in: ids('PRODUCT') } }, include: { variants: { where: { isActive: true }, select: { pricePaise: true }, orderBy: { pricePaise: 'asc' }, take: 1 } } }) : [],
      ids('ORDER').length ? this.prisma.subOrder.findMany({ where: { id: { in: ids('ORDER') } }, include: { items: { select: { qty: true } } } }) : [],
    ]);
    for (const b of bookings) out.set(`BOOKING:${b.id}`, { type: 'BOOKING', id: b.id, code: b.code, title: b.service.name, petName: b.pet.name, startsAt: b.startsAt, status: b.status });
    const images = await this.prisma.mediaAsset.findMany({ where: { id: { in: products.map((p) => p.imageIds[0]).filter(Boolean) } } });
    for (const p of products) {
      const img = images.find((i) => i.id === p.imageIds[0]);
      const v = img ? await this.media.view(img) : null;
      out.set(`PRODUCT:${p.id}`, {
        type: 'PRODUCT', id: p.id, slug: p.slug, title: p.title, available: p.status === 'ACTIVE',
        pricePaise: p.variants[0]?.pricePaise ?? null, imageUrl: v?.images?.[v.images.length - 1]?.url ?? null,
      });
    }
    for (const s of subOrders) out.set(`ORDER:${s.id}`, { type: 'ORDER', id: s.id, code: s.code, status: s.status, totalPaise: s.totalPaise, units: s.items.reduce((a, i) => a + i.qty, 0) });
    return out;
  }
}
