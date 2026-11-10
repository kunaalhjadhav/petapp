import { Inject, Injectable, Logger } from '@nestjs/common';
import { reviewerName } from '../modules/reviews/reviews.rules';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PUSH_PROVIDER, type PushProvider } from '../providers/push/push.provider';
import { renderNotification } from '../modules/notifications/render';
import { extractMentions } from '../modules/notifications/mentions';
import type { NotificationType } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { NotifyEvent } from '../queue/queues';

type PrefKey = 'likes' | 'comments' | 'mentions' | 'follows' | 'posts' | 'chat' | 'reminders' | 'votes' | 'promotions';

interface Delivery {
  recipientId: string;
  type: NotificationType;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  /** Same key → same row (count goes up). Every delivery has one, which makes retries harmless. */
  groupKey: string;
  /** Preference that can switch this off; undefined = always delivered (account and safety notices). */
  pref?: PrefKey;
}

const day = () => new Date().toISOString().slice(0, 10);
const DEFAULT_PREFS = { push: true, likes: true, comments: true, mentions: true, follows: true, posts: true, chat: true, reminders: true, votes: true, promotions: false };
const istWhen = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
const istDate = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(d);

@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async handle(e: NotifyEvent, jobId: string): Promise<number> {
    if (e.type === 'CHAT_MESSAGE') return this.chatPush(e.messageId);
    const deliveries = await this.plan(e, jobId);
    let delivered = 0;
    for (const d of deliveries) if (await this.deliver(d)) delivered++;
    return delivered;
  }

  /** Works out who should hear about an event. */
  private async plan(e: NotifyEvent, jobId: string): Promise<Delivery[]> {
    switch (e.type) {
      case 'POST_LIKE': {
        const post = await this.livePost(e.postId);
        return post ? [{ recipientId: post.authorId, type: e.type, actorId: e.actorId, entityType: 'Post', entityId: post.id, data: { caption: post.caption }, groupKey: `like:${post.id}`, pref: 'likes' }] : [];
      }
      case 'POST_COMMENT':
      case 'COMMENT_REPLY': {
        const post = await this.livePost(e.postId);
        const cm = await this.prisma.comment.findFirst({ where: { id: e.commentId, status: 'VISIBLE', deletedAt: null } });
        if (!post || !cm) return [];
        const out: Delivery[] = [];
        const base = { actorId: e.actorId, entityType: 'Post', entityId: post.id, data: { body: cm.body, commentId: cm.id }, pref: 'comments' as const };
        let parentAuthor: string | null = null;
        if (e.type === 'COMMENT_REPLY') {
          parentAuthor = (await this.prisma.comment.findUnique({ where: { id: e.parentId }, select: { authorId: true } }))?.authorId ?? null;
          if (parentAuthor) out.push({ ...base, recipientId: parentAuthor, type: 'COMMENT_REPLY', groupKey: `reply:${cm.id}` });
        }
        if (post.authorId !== parentAuthor) out.push({ ...base, recipientId: post.authorId, type: 'POST_COMMENT', groupKey: `comment:${cm.id}` });
        return [...out, ...(await this.mentions(e.actorId, post, extractMentions(cm.body), cm.id, cm.body))];
      }
      case 'MENTION': {
        const post = await this.livePost(e.postId);
        return post ? this.mentions(e.actorId, post, e.handles, e.commentId, null) : [];
      }
      case 'NEW_FOLLOWER':
        return [{ recipientId: e.userId, type: e.type, actorId: e.actorId, entityType: 'User', entityId: e.actorId, groupKey: `follow:${day()}`, pref: 'follows' }];
      case 'PET_FOLLOWER': {
        const pet = await this.prisma.pet.findFirst({ where: { id: e.petId, deletedAt: null }, select: { id: true, ownerId: true, name: true } });
        return pet ? [{ recipientId: pet.ownerId, type: e.type, actorId: e.actorId, entityType: 'Pet', entityId: pet.id, data: { petName: pet.name }, groupKey: `petfollow:${pet.id}:${day()}`, pref: 'follows' }] : [];
      }
      case 'POST_PUBLISHED': {
        const post = await this.livePost(e.postId);
        if (!post) return [];
        const own: Delivery[] = e.quiet ? [] : [{ recipientId: post.authorId, type: e.type, entityType: 'Post', entityId: post.id, data: { postType: post.type }, groupKey: `published:${post.id}`, pref: 'posts' }];
        return [...own, ...(await this.mentions(post.authorId, post, extractMentions(post.caption), undefined, post.caption))];
      }
      case 'POST_FAILED': {
        const post = await this.prisma.post.findUnique({ where: { id: e.postId }, select: { id: true, authorId: true } });
        return post ? [{ recipientId: post.authorId, type: e.type, entityType: 'Post', entityId: post.id, groupKey: `failed:${post.id}` }] : [];
      }
      case 'CONTENT_REMOVED':
        return [{ recipientId: e.ownerId, type: e.type, entityType: e.targetType, entityId: e.targetId, data: { targetType: e.targetType, resolution: e.resolution }, groupKey: `removed:${e.targetId}` }];
      case 'ACCOUNT_STATUS':
        return [{ recipientId: e.userId, type: e.type, entityType: 'User', entityId: e.userId, data: { status: e.status }, groupKey: `job:${jobId}` }];
      case 'CONTEST_ENTRY_CONFIRMED': {
        const p = await this.prisma.contestParticipant.findUnique({ where: { id: e.participantId }, include: { contest: { select: { id: true, title: true } }, pet: { select: { name: true } } } });
        return p ? [{ recipientId: p.userId, type: e.type, entityType: 'Contest', entityId: p.contest.id, data: { contestTitle: p.contest.title, petName: p.pet.name }, groupKey: `contest-entry:${p.id}` }] : [];
      }
      case 'CONTEST_VOTING_OPEN':
      case 'CONTEST_RESULT': {
        const c = await this.prisma.contest.findUnique({
          where: { id: e.contestId },
          include: { participants: { where: { status: { in: ['REGISTERED', 'SUBMITTED', 'QUALIFIED', 'FINALIST', 'WINNER'] } }, include: { pet: { select: { name: true } }, prizes: { select: { title: true } } } } },
        });
        if (!c) return [];
        return c.participants.map((p) => ({
          recipientId: p.userId, type: e.type, entityType: 'Contest', entityId: c.id,
          data: { contestTitle: c.title, petName: p.pet.name, prize: e.type === 'CONTEST_RESULT' ? p.prizes[0]?.title ?? null : null },
          groupKey: `${e.type === 'CONTEST_RESULT' ? 'contest-result' : 'contest-voting'}:${c.id}:${p.id}`,
        }));
      }
      case 'CHALLENGE_COMPLETED': {
        const p = await this.prisma.challengeParticipant.findUnique({ where: { id: e.participantId }, include: { challenge: { select: { id: true, title: true } } } });
        return p ? [{ recipientId: p.userId, type: e.type, entityType: 'Challenge', entityId: p.challenge.id, data: { challengeTitle: p.challenge.title, points: p.points }, groupKey: `challenge-done:${p.id}` }] : [];
      }
      case 'PARTNER_STATUS': {
        const p = await this.prisma.servicePartner.findUnique({ where: { id: e.partnerId } });
        return p ? [{ recipientId: p.userId, type: e.type, entityType: 'ServicePartner', entityId: p.id, data: { businessName: p.businessName, status: p.status, reason: p.statusReason }, groupKey: `job:${jobId}` }] : [];
      }
      case 'BOOKING_CONFIRMED':
      case 'BOOKING_CANCELLED':
      case 'BOOKING_COMPLETED': {
        const b = await this.prisma.booking.findUnique({ where: { id: e.bookingId }, include: { service: true, partner: true, pet: true } });
        if (!b) return [];
        const data = {
          code: b.code, serviceName: b.service.name, partnerName: b.partner.businessName, petName: b.pet.name, refundPaise: b.refundPaise,
          byPartner: b.cancelledBy === 'PARTNER',
          when: new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(b.startsAt),
        };
        const toCustomer = { recipientId: b.customerId, type: e.type, entityType: 'Booking', entityId: b.id, data, groupKey: `${e.type}:${b.id}:c` };
        const toPartner = { recipientId: b.partner.userId, type: e.type, entityType: 'Booking', entityId: b.id, data: { ...data, forPartner: true }, groupKey: `${e.type}:${b.id}:p` };
        if (e.type === 'BOOKING_COMPLETED') return [toCustomer];
        if (e.type === 'BOOKING_CANCELLED') return b.cancelledBy === 'PARTNER' ? [toCustomer] : b.cancelledBy === 'CUSTOMER' ? [toPartner] : [toCustomer, toPartner];
        return [toCustomer, toPartner];
      }
      case 'VENDOR_STATUS': {
        const v = await this.prisma.vendor.findUnique({ where: { id: e.vendorId } });
        return v ? [{ recipientId: v.userId, type: e.type, entityType: 'Vendor', entityId: v.id, data: { businessName: v.businessName, status: v.status, reason: v.statusReason }, groupKey: `job:${jobId}` }] : [];
      }
      case 'ORDER_CONFIRMED': {
        const o = await this.prisma.order.findUnique({ where: { id: e.orderId }, include: { subOrders: { include: { vendor: true, items: true } } } });
        if (!o) return [];
        const units = (s: (typeof o.subOrders)[number]) => s.items.reduce((a, i) => a + i.qty, 0);
        return [
          { recipientId: o.userId, type: 'ORDER_CONFIRMED' as const, entityType: 'Order', entityId: o.id, data: { code: o.code, totalPaise: o.totalPaise, parcels: o.subOrders.length }, groupKey: `order-confirmed:${o.id}` },
          ...o.subOrders.map((s) => ({
            recipientId: s.vendor.userId, type: 'VENDOR_NEW_ORDER' as const, entityType: 'SubOrder', entityId: s.id,
            data: { code: s.code, units: units(s), totalPaise: s.totalPaise }, groupKey: `vendor-order:${s.id}`,
          })),
        ];
      }
      case 'ORDER_UPDATE': {
        const s = await this.prisma.subOrder.findUnique({
          where: { id: e.subOrderId },
          include: { vendor: true, order: true, returns: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        if (!s) return [];
        const refund = await this.prisma.refund.aggregate({ where: { reference: { in: [`SubOrder:${s.id}`, ...s.returns.map((r) => `Return:${r.id}`)] } }, _sum: { amountPaise: true } });
        const data = {
          code: s.code, status: s.status, vendorName: s.vendor.businessName, courier: s.courier, trackingNumber: s.trackingNumber,
          cancelledBy: s.cancelledBy, cancelReason: s.cancelReason, returnStatus: s.returns[0]?.status ?? null, refundPaise: refund._sum.amountPaise ?? 0,
          forVendor: e.to === 'vendor',
        };
        return [{
          recipientId: e.to === 'vendor' ? s.vendor.userId : s.order.userId, type: e.type, entityType: 'SubOrder', entityId: s.id, data,
          groupKey: `order-update:${s.id}:${s.status}:${data.returnStatus ?? ''}:${e.to}`,
        }];
      }
      case 'REFUND_PROCESSED': {
        const r = await this.prisma.refund.findUnique({ where: { id: e.refundId }, include: { payment: { include: { order: { select: { id: true, code: true } }, booking: { select: { id: true, code: true } } } } } });
        if (!r) return [];
        const p = r.payment;
        // Open the order or booking the refund belongs to, when there is one.
        const target = p.order ? { entityType: 'Order', entityId: p.order.id, what: `order ${p.order.code}` }
          : p.booking ? { entityType: 'Booking', entityId: p.booking.id, what: `booking ${p.booking.code}` }
          : { entityType: 'Payment', entityId: p.id, what: p.purpose === 'CONTEST_REGISTRATION' ? 'your contest entry' : p.purpose === 'CHALLENGE_JOIN' ? 'your challenge entry' : 'your payment' };
        return [{ recipientId: p.userId, type: e.type, entityType: target.entityType, entityId: target.entityId, data: { amountPaise: r.amountPaise, what: target.what }, groupKey: `refund:${r.id}` }];
      }
      case 'PAYOUT_UPDATE': {
        const p = await this.prisma.payout.findUnique({ where: { id: e.payoutId }, include: { account: { select: { accountLast4: true, vpa: true } } } });
        if (!p) return [];
        const recipientId = await this.payeeUser(p.payeeType, p.payeeId);
        return recipientId ? [{ recipientId, type: e.type, entityType: 'Payout', entityId: p.id, data: { status: p.status, amountPaise: p.amountPaise, utr: p.utr, last4: p.account.accountLast4, vpa: p.account.vpa }, groupKey: `payout:${p.id}:${p.status}` }] : [];
      }
      case 'PAYOUT_ACCOUNT': {
        const a = await this.prisma.payoutAccount.findUnique({ where: { id: e.accountId } });
        if (!a) return [];
        const recipientId = await this.payeeUser(a.ownerType, a.ownerId);
        const later = a.payableFrom && a.verifiedAt && a.payableFrom.getTime() - a.verifiedAt.getTime() > 60_000;
        const payableFrom = later ? new Date(a.payableFrom!.getTime() + 330 * 60_000).toISOString().replace('T', ' ').slice(0, 16) + ' IST' : null;
        return recipientId ? [{ recipientId, type: e.type, entityType: 'PayoutAccount', entityId: a.id, data: { status: a.status, last4: a.accountLast4, vpa: a.vpa, reason: a.failureReason, payableFrom }, groupKey: `payout-account:${a.id}:${a.status}` }] : [];
      }
      case 'DATA_EXPORT_READY': {
        const x = await this.prisma.dataExport.findUnique({ where: { id: e.exportId }, select: { id: true, userId: true, status: true, expiresAt: true } });
        if (!x || x.status !== 'READY') return [];
        const until = x.expiresAt ? new Date(x.expiresAt.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null;
        return [{ recipientId: x.userId, type: e.type, entityType: 'DataExport', entityId: x.id, data: { until }, groupKey: `export:${x.id}` }];
      }
      case 'CHAT_MESSAGE':
        return []; // handled by chatPush (push only)
      case 'SUPPORT_UPDATE': {
        const t = await this.prisma.supportTicket.findUnique({ where: { id: e.ticketId }, select: { id: true, code: true, subject: true, userId: true, app: true } });
        if (!t) return [];
        const m = e.messageId ? await this.prisma.chatMessage.findFirst({ where: { id: e.messageId, internal: false, status: 'VISIBLE' }, select: { body: true } }) : null;
        if (e.messageId && !m) return [];
        return [{ recipientId: t.userId, type: e.type, entityType: 'SupportTicket', entityId: t.id, data: { code: t.code, subject: t.subject, body: m?.body ?? null, status: e.status ?? null, app: t.app }, groupKey: `support:${t.id}:${e.messageId ?? e.status}` }];
      }
      case 'REVIEW_RECEIVED':
      case 'REVIEW_REPLY': {
        const r = e.kind === 'PRODUCT'
          ? await this.prisma.productReview.findUnique({ where: { id: e.reviewId }, include: { product: { select: { id: true, title: true } }, vendor: { select: { userId: true, businessName: true } }, customer: { select: { name: true } } } })
          : null;
        const sr = e.kind === 'SERVICE'
          ? await this.prisma.serviceReview.findUnique({ where: { id: e.reviewId }, include: { booking: { select: { id: true, service: { select: { name: true } } } }, partner: { select: { userId: true, businessName: true } }, customer: { select: { name: true } } } })
          : null;
        const row = r ?? sr;
        if (!row || row.status !== 'VISIBLE') return [];
        const business = r ? r.vendor : sr!.partner;
        const about = r ? r.product.title : sr!.booking.service.name;
        if (e.type === 'REVIEW_RECEIVED') {
          return [{
            recipientId: business.userId, type: e.type, entityType: r ? 'ProductReview' : 'ServiceReview', entityId: row.id,
            data: { rating: row.rating, about, by: reviewerName(row.customer.name), comment: row.comment }, groupKey: `review:${row.id}`,
          }];
        }
        if (!row.reply) return [];
        // The customer opens what they reviewed: the product, or the booking.
        return [{
          recipientId: row.customerId, type: e.type, entityType: r ? 'Product' : 'Booking', entityId: r ? r.product.id : sr!.booking.id,
          data: { business: business.businessName, about, reply: row.reply }, groupKey: `review-reply:${row.id}`,
        }];
      }
      case 'BOOKING_REMINDER': {
        const b = await this.prisma.booking.findUnique({ where: { id: e.bookingId }, include: { service: true, partner: true, pet: true } });
        if (!b || b.status !== 'CONFIRMED' || b.startsAt <= new Date()) return [];
        return [{
          recipientId: b.customerId, type: e.type, entityType: 'Booking', entityId: b.id,
          data: { code: b.code, serviceName: b.service.name, partnerName: b.partner.businessName, petName: b.pet.name, when: istWhen(b.startsAt), atHome: b.mode === 'AT_HOME' },
          groupKey: `booking-reminder:${b.id}`, pref: 'reminders',
        }];
      }
      case 'CONTEST_REMINDER': {
        const p = await this.prisma.contestParticipant.findUnique({ where: { id: e.participantId }, include: { contest: true, pet: { select: { name: true } } } });
        if (!p) return [];
        const c = p.contest;
        // Still relevant when it goes out: not yet submitted for SUBMIT, still in the running for VOTING.
        if (e.stage === 'SUBMIT' && (p.status !== 'REGISTERED' || c.status !== 'LIVE' || c.submissionClosesAt <= new Date())) return [];
        if (e.stage === 'VOTING' && (!['SUBMITTED', 'QUALIFIED', 'FINALIST'].includes(p.status) || c.status !== 'VOTING' || c.votingClosesAt <= new Date())) return [];
        return [{
          recipientId: p.userId, type: e.type, entityType: 'Contest', entityId: c.id,
          data: { stage: e.stage, contestTitle: c.title, contestSlug: c.slug, petName: p.pet.name, when: istWhen(e.stage === 'SUBMIT' ? c.submissionClosesAt : c.votingClosesAt) },
          groupKey: `contest-reminder:${e.stage}:${p.id}`, pref: 'reminders',
        }];
      }
      case 'CONTEST_VOTES': {
        const p = await this.prisma.contestParticipant.findUnique({ where: { id: e.participantId }, include: { contest: { select: { id: true, title: true, slug: true } }, pet: { select: { name: true } } } });
        if (!p) return [];
        const since = new Date(e.since);
        const votes = await this.prisma.contestVote.count({ where: { participantId: p.id, flagged: false, createdAt: { gte: since, lt: new Date(since.getTime() + 3_600_000) } } });
        if (!votes) return [];
        return [{
          recipientId: p.userId, type: e.type, entityType: 'Contest', entityId: p.contest.id,
          data: { votes, petName: p.pet.name, contestTitle: p.contest.title, contestSlug: p.contest.slug, participantId: p.id },
          groupKey: `votes:${p.id}:${e.since}`, pref: 'votes',
        }];
      }
      case 'MEMBERSHIP_UPDATE': {
        const m = await this.prisma.membership.findUnique({ where: { id: e.membershipId }, include: { plan: { select: { name: true } } } });
        // Queued inside the payment's transaction: if it hasn't committed yet, try again shortly (the job is retried).
        if ((e.event === 'ACTIVE' || e.event === 'RENEWED') && (!m || m.status === 'PENDING_PAYMENT')) throw new Error(`membership ${e.membershipId} not started yet`);
        if (!m) return [];
        const until = m.endsAt ? istDate(m.endsAt) : null;
        return [{
          recipientId: m.userId, type: e.type, entityType: 'Membership', entityId: m.id, data: { event: e.event, plan: m.plan.name, until },
          groupKey: `membership:${m.id}:${e.event}`, ...(e.event === 'ENDING' ? { pref: 'reminders' as const } : {}),
        }];
      }
      case 'BADGE_EARNED': {
        const b = await this.prisma.badge.findUnique({ where: { id: e.badgeId } });
        return b ? [{ recipientId: e.userId, type: e.type, entityType: 'Badge', entityId: b.id, data: { badgeName: b.name }, groupKey: `badge:${b.id}` }] : [];
      }
    }
  }

  /**
   * A chat message: push only (chat keeps its own unread counts). Skipped when the person has the app open (it
   * arrives live), when they turned chat pushes off, or for 30 seconds after the last push in that conversation,
   * so a burst of messages is one notification.
   */
  private async chatPush(messageId: string): Promise<number> {
    const m = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: { media: { select: { kind: true } }, sender: { select: { name: true } }, conversation: { include: { partner: { select: { userId: true, businessName: true } }, vendor: { select: { userId: true, businessName: true } } } } },
    });
    if (!m || m.status !== 'VISIBLE' || m.internal || (m.side !== 'CUSTOMER' && m.side !== 'BUSINESS')) return 0;
    const c = m.conversation;
    const business = c.partner ?? c.vendor;
    const recipientId = m.side === 'CUSTOMER' ? business?.userId : c.customerId;
    if (!recipientId || !m.senderId) return 0;
    if (await this.redis.client.exists(`chat:online:${recipientId}`)) return 0;
    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId }, select: { status: true, notificationPreference: true } });
    if (!recipient || recipient.status !== 'ACTIVE') return 0;
    const prefs = recipient.notificationPreference ?? DEFAULT_PREFS;
    if (!prefs.push || !prefs.chat) return 0;
    const blocked = await this.prisma.block.count({ where: { OR: [{ blockerId: recipientId, blockedId: m.senderId }, { blockerId: m.senderId, blockedId: recipientId }] } });
    if (blocked) return 0;
    const devices = await this.prisma.deviceToken.findMany({ where: { userId: recipientId }, select: { token: true } });
    if (!devices.length) return 0;
    const fresh = await this.redis.client.set(`chat:pushed:${recipientId}:${c.id}`, '1', 'EX', 30, 'NX');
    if (!fresh) return 0;
    const senderName = m.side === 'BUSINESS' ? business?.businessName : m.sender?.name?.trim() || 'A customer';
    const preview = m.body?.trim() || (m.media?.kind === 'IMAGE' ? '📷 Photo' : m.refType ? `Shared a ${m.refType.toLowerCase()}` : '');
    const { title, body } = renderNotification({ type: 'CHAT_MESSAGE', count: 1, data: { senderName, preview } });
    // Which app should open it: the customer app, or the partner or seller app.
    const app = m.side === 'BUSINESS' ? 'customer' : c.kind === 'SERVICE' ? 'partner' : 'seller';
    for (const { token } of devices) {
      const r = await this.push.send({ token, title, body, data: { type: 'CHAT_MESSAGE', entityType: 'Conversation', entityId: c.id, app } });
      if (r === 'invalid-token') await this.prisma.deviceToken.deleteMany({ where: { token } });
    }
    return 1;
  }

  /** The user behind a payee: the seller's or partner's owner, or the user themselves. */
  private async payeeUser(type: string, id: string): Promise<string | null> {
    if (type === 'VENDOR') return (await this.prisma.vendor.findUnique({ where: { id }, select: { userId: true } }))?.userId ?? null;
    if (type === 'PARTNER') return (await this.prisma.servicePartner.findUnique({ where: { id }, select: { userId: true } }))?.userId ?? null;
    return id;
  }

  private livePost(id: string) {
    return this.prisma.post.findFirst({
      where: { id, status: 'PUBLISHED', deletedAt: null },
      select: { id: true, authorId: true, caption: true, type: true, visibility: true },
    });
  }

  /** Mentioned pets' owners — only if they can actually see the post. */
  private async mentions(actorId: string, post: { id: string; authorId: string; visibility: string }, handles: string[], commentId: string | undefined, body: string | null): Promise<Delivery[]> {
    if (!handles.length) return [];
    const pets = await this.prisma.pet.findMany({ where: { handle: { in: handles }, deletedAt: null, status: 'ACTIVE' }, select: { id: true, name: true, ownerId: true } });
    const out: Delivery[] = [];
    for (const pet of pets) {
      if (post.visibility === 'FOLLOWERS' && pet.ownerId !== post.authorId) {
        const follows = await this.prisma.userFollower.count({ where: { followerId: pet.ownerId, followingId: post.authorId } });
        if (!follows) continue;
      }
      out.push({
        recipientId: pet.ownerId, type: 'MENTION', actorId, entityType: 'Post', entityId: post.id,
        data: { petName: pet.name, petId: pet.id, body, commentId }, groupKey: `mention:${post.id}:${commentId ?? 'post'}:${pet.id}`, pref: 'mentions',
      });
    }
    return out;
  }

  /** Applies the rules, writes or updates the row, then pushes. Returns true if anything was delivered. */
  private async deliver(d: Delivery): Promise<boolean> {
    if (d.actorId && d.actorId === d.recipientId) return false;
    const recipient = await this.prisma.user.findUnique({
      where: { id: d.recipientId },
      select: { status: true, notificationPreference: true },
    });
    if (!recipient) return false;
    if (recipient.status !== 'ACTIVE' && d.type !== 'ACCOUNT_STATUS') return false;
    if (d.actorId) {
      const blocked = await this.prisma.block.count({ where: { OR: [{ blockerId: d.recipientId, blockedId: d.actorId }, { blockerId: d.actorId, blockedId: d.recipientId }] } });
      if (blocked) return false;
    }
    const prefs = recipient.notificationPreference ?? DEFAULT_PREFS;
    if (d.pref && !prefs[d.pref]) return false;

    // Each actor counts once per group (a like, unlike, like again is still one).
    const seenKey = `notif:seen:${d.recipientId}:${d.groupKey}`;
    const fresh = await this.redis.client.sadd(seenKey, d.actorId ?? 'system');
    await this.redis.client.expire(seenKey, 30 * 86_400);
    if (!fresh) return false;

    let row;
    try {
      row = await this.prisma.notification.upsert({
        where: { userId_groupKey: { userId: d.recipientId, groupKey: d.groupKey } },
        update: { count: { increment: 1 }, actorId: d.actorId, readAt: null, data: (d.data ?? {}) as Prisma.InputJsonValue },
        create: { userId: d.recipientId, type: d.type, actorId: d.actorId, entityType: d.entityType, entityId: d.entityId, data: (d.data ?? {}) as Prisma.InputJsonValue, groupKey: d.groupKey },
        include: { actor: { select: { name: true } } },
      });
    } catch (err) {
      await this.redis.client.srem(seenKey, d.actorId ?? 'system'); // let the retry count it
      throw err;
    }

    if (prefs.push) await this.pushTo(d.recipientId, row.id, { type: row.type, actorName: row.actor?.name, count: row.count, data: row.data as Record<string, unknown> }, d);
    return true;
  }

  private async pushTo(userId: string, notificationId: string, input: Parameters<typeof renderNotification>[0], d: Delivery) {
    const devices = await this.prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
    if (!devices.length) return;
    const { title, body } = renderNotification(input);
    const data = { notificationId, type: d.type, entityType: d.entityType ?? '', entityId: d.entityId ?? '' };
    for (const { token } of devices) {
      const r = await this.push.send({ token, title, body, data });
      if (r === 'invalid-token') {
        await this.prisma.deviceToken.deleteMany({ where: { token } });
        this.logger.log(`removed dead device token …${token.slice(-6)}`);
      }
    }
  }
}
