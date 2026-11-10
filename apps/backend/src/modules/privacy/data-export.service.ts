import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../providers/storage/storage.service';
import { QueueService } from '../../queue/queue.service';
import { PlatformService } from '../platform/platform.service';
import { AuditService } from '../audit/audit.service';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';

const DAY = 86_400_000;
export const EXPORT_LINK_TTL_SECONDS = 300;
export const exportKey = (userId: string, id: string) => `exports/${userId}/${id}.json`;

/** Fields that are never part of an export: secrets, internal hashes and provider ids. */
const NEVER = /^(passwordHash|tokenHash|token|familyId|replacedById|accountNumberEnc|inputHash|perceptualHash|ipHash|providerContactId|providerFundAccountId|providerValidationId|storageKey|variants)$/;

/** Drops secret fields everywhere in a value and turns Decimals and BigInts into plain numbers. */
export function clean(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(clean);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown> & { toNumber?: () => number };
    if (typeof o.toNumber === 'function' && o.constructor?.name === 'Decimal') return o.toNumber();
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) if (!NEVER.test(k)) out[k] = clean(val);
    return out;
  }
  return v;
}

/**
 * A copy of everything PetApp holds about a person (DPDP Act right to access), built by the worker as one JSON file
 * in private storage and downloadable for a few days through a short-lived link.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string) {
    const items = await this.prisma.dataExport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, status: true, sizeBytes: true, createdAt: true, readyAt: true, expiresAt: true },
    });
    const next = this.nextAllowed(items);
    return { items, canRequest: !next, nextAllowedAt: next };
  }

  /** One at a time, and one a day (building an export reads a lot of data). */
  private nextAllowed(items: Array<{ status: string; createdAt: Date }>): Date | null {
    if (items.some((e) => e.status === 'PENDING')) return new Date(Date.now() + 60_000);
    const last = items.find((e) => e.status !== 'FAILED' && e.createdAt.getTime() > Date.now() - DAY);
    return last ? new Date(last.createdAt.getTime() + DAY) : null;
  }

  async request(userId: string, meta: RequestMetaInfo) {
    if (!this.storage.configured) throw new ServiceUnavailableException('Downloads aren’t available right now. Please try again later.');
    const e = await this.prisma.$transaction(async (tx) => {
      // One request at a time per person, even if the button is pressed twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'export:' + userId}))`;
      const recent = await tx.dataExport.findMany({ where: { userId, createdAt: { gt: new Date(Date.now() - DAY) } }, select: { status: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
      const pending = await tx.dataExport.count({ where: { userId, status: 'PENDING' } });
      if (pending) throw new ConflictException('Your copy is already being prepared. We’ll notify you when it’s ready.');
      if (this.nextAllowed(recent)) throw new ConflictException('You can ask for a copy of your data once a day. Download the one you already have.');
      const created = await tx.dataExport.create({ data: { userId } });
      await this.audit.log({ actorId: userId, action: 'user.data_export', entityType: 'DataExport', entityId: created.id, meta }, tx);
      return created;
    });
    await this.queue.buildExport(e.id);
    return this.list(userId);
  }

  /** A five-minute download link, only for the person's own ready export. */
  async link(userId: string, id: string) {
    const e = await this.prisma.dataExport.findFirst({ where: { id, userId } });
    if (!e) throw new NotFoundException('Download not found.');
    if (e.status !== 'READY' || !e.storageKey || (e.expiresAt && e.expiresAt < new Date())) throw new NotFoundException('This download has expired. Ask for a new copy.');
    const name = `petapp-data-${e.createdAt.toISOString().slice(0, 10)}.json`;
    return { url: await this.storage.privateExportUrl(e.storageKey, name, EXPORT_LINK_TTL_SECONDS), expiresInSeconds: EXPORT_LINK_TTL_SECONDS, fileName: name };
  }

  // ── worker ──

  async build(id: string, lastAttempt: boolean): Promise<string> {
    const e = await this.prisma.dataExport.findUnique({ where: { id } });
    if (!e || e.status !== 'PENDING') return 'skipped';
    try {
      const data = await this.collect(e.userId);
      const body = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
      const key = exportKey(e.userId, e.id);
      await this.storage.putPrivate(key, body, 'application/json; charset=utf-8');
      const days = await this.platform.getSetting<number>('privacy.exportDays');
      const now = new Date();
      await this.prisma.dataExport.update({ where: { id }, data: { status: 'READY', storageKey: key, sizeBytes: body.length, readyAt: now, expiresAt: new Date(now.getTime() + days * DAY) } });
      this.queue.notify({ type: 'DATA_EXPORT_READY', exportId: id });
      return 'ready';
    } catch (err) {
      this.logger.error(`export ${id} failed: ${(err as Error).message}`);
      if (lastAttempt) await this.prisma.dataExport.update({ where: { id }, data: { status: 'FAILED', error: (err as Error).message.slice(0, 500) } });
      throw err;
    }
  }

  /** Deletes expired downloads (nightly). */
  async purgeExpired(): Promise<number> {
    const old = await this.prisma.dataExport.findMany({ where: { status: 'READY', expiresAt: { lt: new Date() } }, select: { id: true, storageKey: true }, take: 500 });
    for (const e of old) {
      if (e.storageKey) await this.storage.deletePrefix(e.storageKey);
      await this.prisma.dataExport.update({ where: { id: e.id }, data: { status: 'EXPIRED', storageKey: null } });
    }
    return old.length;
  }

  /** Everything about one person, grouped the way the app shows it. */
  async collect(userId: string) {
    const p = this.prisma;
    const [user, partner, vendor] = await Promise.all([
      p.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: { select: { role: { select: { key: true, name: true } } } }, identities: true, notificationPreference: true, risk: false } }),
      p.servicePartner.findUnique({ where: { userId }, include: { services: true, hours: true, timeOff: true, documents: { select: { id: true, kind: true, status: true, createdAt: true } } } }),
      p.vendor.findUnique({ where: { userId }, include: { documents: { select: { id: true, kind: true, status: true, createdAt: true } } } }),
    ]);
    const payeeIds = [userId, partner?.id, vendor?.id].filter((x): x is string => Boolean(x));
    const [
      addresses, sessions, devices, pets, posts, comments, likes, saves, shares, followingUsers, followingPets, blocks, reports,
      notifications, orders, bookings, reviews, returns, payments, invoices, contestEntries, votes, challenges, badges, cart, coupons,
      payoutAccounts, payouts, assistant, interests, dismissals, consents, media, conversations, sentElsewhere, tickets, productReviews,
      memberships, activeDays,
    ] = await Promise.all([
      p.address.findMany({ where: { userId } }),
      p.session.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      p.deviceToken.findMany({ where: { userId } }),
      p.pet.findMany({ where: { ownerId: userId }, include: { species: { select: { name: true } }, breed: { select: { name: true } }, vaccinations: true } }),
      p.post.findMany({ where: { authorId: userId }, include: { media: { select: { mediaId: true, position: true } }, pets: { select: { petId: true } }, hashtags: { select: { hashtag: { select: { tag: true } } } } } }),
      p.comment.findMany({ where: { authorId: userId }, select: { id: true, postId: true, parentId: true, body: true, status: true, createdAt: true, deletedAt: true } }),
      p.postLike.findMany({ where: { userId } }),
      p.postSave.findMany({ where: { userId } }),
      p.postShare.findMany({ where: { userId } }),
      p.userFollower.findMany({ where: { followerId: userId }, select: { followingId: true, createdAt: true } }),
      p.petFollower.findMany({ where: { userId }, select: { petId: true, createdAt: true } }),
      p.block.findMany({ where: { blockerId: userId }, select: { blockedId: true, createdAt: true } }),
      p.report.findMany({ where: { reporterId: userId }, select: { targetType: true, targetId: true, reason: true, details: true, evidenceIds: true, status: true, createdAt: true } }),
      p.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500, select: { type: true, entityType: true, entityId: true, data: true, readAt: true, createdAt: true } }),
      p.order.findMany({ where: { userId }, include: { subOrders: { include: { items: true, vendor: { select: { businessName: true } } } } } }),
      p.booking.findMany({ where: { customerId: userId }, include: { service: { select: { name: true } }, partner: { select: { businessName: true } } } }),
      p.serviceReview.findMany({ where: { customerId: userId } }),
      p.returnRequest.findMany({ where: { userId } }),
      p.payment.findMany({ where: { userId }, include: { refunds: { select: { amountPaise: true, status: true, reason: true, reference: true, createdAt: true, processedAt: true } } } }),
      p.invoice.findMany({ where: { customerId: userId }, select: { number: true, kind: true, title: true, issuedAt: true, totalPaise: true, taxablePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }),
      p.contestParticipant.findMany({ where: { userId }, include: { contest: { select: { title: true } }, submissions: true } }),
      p.contestVote.findMany({ where: { voterId: userId }, select: { contestId: true, participantId: true, voteDate: true, createdAt: true } }),
      p.challengeParticipant.findMany({ where: { userId }, include: { challenge: { select: { title: true } } } }),
      p.userBadge.findMany({ where: { userId }, include: { badge: { select: { name: true } } } }),
      p.cartItem.findMany({ where: { userId } }),
      p.couponRedemption.findMany({ where: { userId } }),
      p.payoutAccount.findMany({ where: { ownerId: { in: payeeIds } } }),
      p.payout.findMany({ where: { payeeId: { in: payeeIds } }, select: { amountPaise: true, status: true, utr: true, createdAt: true } }),
      p.assistantConversation.findMany({ where: { userId }, include: { messages: { orderBy: { createdAt: 'asc' }, select: { role: true, text: true, createdAt: true, rating: true, ratingNote: true } } } }),
      p.interestEvent.findMany({ where: { userId } }),
      p.recoDismissal.findMany({ where: { userId } }),
      p.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      p.mediaAsset.findMany({ where: { ownerId: userId }, select: { id: true, kind: true, status: true, mimeType: true, sizeBytes: true, width: true, height: true, durationMs: true, createdAt: true } }),
      // Chats and support threads they are the customer in (staff notes are never included), and messages they sent as a business.
      p.conversation.findMany({
        where: { customerId: userId },
        select: {
          id: true, kind: true, createdAt: true, partner: { select: { businessName: true } }, vendor: { select: { businessName: true } },
          messages: { where: { internal: false }, orderBy: { createdAt: 'asc' }, select: { side: true, body: true, mediaId: true, refType: true, refId: true, status: true, createdAt: true } },
        },
      }),
      p.chatMessage.findMany({ where: { senderId: userId, conversation: { customerId: { not: userId } }, internal: false }, select: { conversationId: true, body: true, mediaId: true, refType: true, refId: true, status: true, createdAt: true } }),
      p.supportTicket.findMany({ where: { userId }, select: { code: true, subject: true, status: true, priority: true, conversationId: true, createdAt: true, resolvedAt: true, closedAt: true, category: { select: { name: true } } } }),
      p.productReview.findMany({ where: { customerId: userId }, select: { rating: true, comment: true, photoIds: true, reply: true, status: true, variantTitle: true, createdAt: true, product: { select: { title: true } } } }),
      // Phase 9d: memberships, and the days they used the app (only the day is recorded).
      p.membership.findMany({ where: { userId, status: { not: 'PENDING_PAYMENT' } }, select: { status: true, startsAt: true, endsAt: true, pricePaise: true, source: true, createdAt: true, plan: { select: { name: true } } } }),
      p.userActivity.findMany({ where: { userId }, orderBy: { day: 'desc' }, take: 400, select: { day: true } }),
    ]);
    const { roles, identities, notificationPreference, ...profile } = user;
    return clean({
      about: {
        generatedAt: new Date(),
        format: 'PetApp data export v1',
        note: 'Everything PetApp holds about you. Photos and videos are listed here; download them from the app before deleting your account. Amounts are in paise (₹1 = 100 paise).',
      },
      profile: { ...profile, roles: roles.map((r) => r.role.key) },
      signIns: { methods: identities, sessions, devices },
      notificationSettings: notificationPreference,
      addresses,
      pets,
      social: { posts, comments, likes, saves, shares, followingUsers, followingPets, blocked: blocks, reportsYouMade: reports, notifications },
      media,
      shop: { orders, returns, cart, couponsUsed: coupons, reviews: productReviews },
      services: { bookings, reviews },
      contests: { entries: contestEntries, votesCast: votes },
      challenges: { entries: challenges, badges },
      money: { payments, invoices, payoutAccounts, payouts, memberships },
      daysActive: activeDays.map((a) => a.day),
      assistant: { conversations: assistant },
      messages: { conversations, sentAsBusiness: sentElsewhere, supportTickets: tickets },
      recommendations: { viewed: interests, notInterested: dismissals },
      consents,
      business: { servicePartner: partner, seller: vendor },
    });
  }
}
