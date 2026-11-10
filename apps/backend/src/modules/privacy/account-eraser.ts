import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../providers/storage/storage.service';
import { PlatformService } from '../platform/platform.service';
import { AuditService } from '../audit/audit.service';
import { originalKey, variantPrefix } from '../media/media.rules';

const DAY = 86_400_000;

export type EraseResult = { status: 'erased' } | { status: 'deferred'; reasons: string[] } | { status: 'skipped'; reason: string };

/**
 * Erases an account after its grace period (DPDP Act right to erasure).
 *
 * Erased: the profile (name, phone, email, photo, birthday, city, preferences), sign-in methods, sessions, devices,
 * addresses, notifications, follows, blocks, likes and saves, assistant chats, viewing history, data exports,
 * risk records, pets' private details, posts with their photos and videos, comments, and bank account numbers.
 *
 * Kept, without the profile, because tax and accounting law require it: orders, bookings, payments, refunds,
 * invoices, ledger entries, payouts, contest and challenge records. Consent records are kept as evidence. Businesses
 * (service partners and sellers) are closed but their business records stay.
 *
 * Deferred (tried again every night) while money or a service is still in progress: an order not yet delivered,
 * an upcoming booking, a refund or payout not yet finished, or money PetApp still owes them.
 */
@Injectable()
export class AccountEraser {
  private readonly logger = new Logger(AccountEraser.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
  ) {}

  /** Nightly: every account whose grace period has ended. */
  async sweep(): Promise<{ erased: number; deferred: number }> {
    const days = await this.platform.getSetting<number>('privacy.deletionGraceDays');
    const due = await this.prisma.user.findMany({
      where: { status: 'PENDING_DELETION', deletedAt: { lte: new Date(Date.now() - days * DAY) } },
      select: { id: true },
      orderBy: { deletedAt: 'asc' },
      take: 200,
    });
    let erased = 0;
    let deferred = 0;
    for (const u of due) {
      try {
        const r = await this.erase(u.id);
        if (r.status === 'erased') erased++;
        if (r.status === 'deferred') deferred++;
      } catch (e) {
        this.logger.error(`could not erase account ${u.id}: ${(e as Error).message}`);
      }
    }
    if (due.length) this.logger.log(`accounts erased ${erased}, deferred ${deferred}`);
    return { erased, deferred };
  }

  /** What still stops an account from being erased. */
  async blockers(userId: string): Promise<string[]> {
    const p = this.prisma;
    const [partner, vendor] = await Promise.all([
      p.servicePartner.findUnique({ where: { userId }, select: { id: true } }),
      p.vendor.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    const payees = [userId, partner?.id, vendor?.id].filter((x): x is string => Boolean(x));
    const now = new Date();
    const [orders, bookings, partnerBookings, vendorParcels, returns, refunds, payouts, owed] = await Promise.all([
      p.subOrder.count({ where: { order: { userId }, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED', 'RETURN_REQUESTED'] } } }),
      p.booking.count({ where: { customerId: userId, status: { in: ['CONFIRMED', 'IN_PROGRESS'] } } }),
      partner ? p.booking.count({ where: { partnerId: partner.id, status: { in: ['CONFIRMED', 'IN_PROGRESS'] }, endsAt: { gt: new Date(now.getTime() - DAY) } } }) : 0,
      vendor ? p.subOrder.count({ where: { vendorId: vendor.id, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED', 'RETURN_REQUESTED'] } } }) : 0,
      p.returnRequest.count({ where: { userId, status: { in: ['REQUESTED', 'APPROVED'] } } }),
      p.refund.count({ where: { payment: { userId }, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } } }),
      p.payout.count({ where: { payeeId: { in: payees }, status: { in: ['DRAFT', 'QUEUED', 'PROCESSING'] } } }),
      this.owed(payees),
    ]);
    const out: string[] = [];
    if (orders) out.push(`${orders} order parcel${orders === 1 ? '' : 's'} not yet delivered`);
    if (bookings) out.push(`${bookings} booking${bookings === 1 ? '' : 's'} not yet completed`);
    if (partnerBookings) out.push(`${partnerBookings} customer booking${partnerBookings === 1 ? '' : 's'} at their business`);
    if (vendorParcels) out.push(`${vendorParcels} customer order${vendorParcels === 1 ? '' : 's'} at their store`);
    if (returns) out.push(`${returns} return${returns === 1 ? '' : 's'} in progress`);
    if (refunds) out.push(`${refunds} refund${refunds === 1 ? '' : 's'} not yet paid`);
    if (payouts) out.push(`${payouts} payout${payouts === 1 ? '' : 's'} in progress`);
    if (owed > 0) out.push(`₹${(owed / 100).toLocaleString('en-IN')} still owed to them`);
    return out;
  }

  /** Money PetApp still holds for these payees (their liability balances). */
  private async owed(payees: string[]): Promise<number> {
    const [r] = await this.prisma.$queryRaw<Array<{ owed: bigint | null }>>`
      SELECT COALESCE(SUM(e."creditPaise" - e."debitPaise"), 0) AS owed
      FROM "LedgerAccount" a JOIN "LedgerEntry" e ON e."accountId" = a.id
      WHERE a.type = 'LIABILITY' AND a."ownerId" = ANY(${payees}::uuid[])`;
    return Number(r?.owed ?? 0);
  }

  /** Erases one account. `actorId` is the staff member when done by hand ("erase now"). */
  async erase(userId: string, actorId?: string): Promise<EraseResult> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, statusReason: true } });
    if (!u) return { status: 'skipped', reason: 'not found' };
    if (u.status !== 'PENDING_DELETION') return { status: 'skipped', reason: `account is ${u.status.toLowerCase()}` };

    const reasons = await this.blockers(userId);
    if (reasons.length) {
      const why = `Waiting: ${reasons.join('; ')}`;
      if (u.statusReason !== why) {
        await this.prisma.user.update({ where: { id: userId }, data: { statusReason: why } });
        await this.audit.log({ actorId: actorId ?? null, action: 'user.delete_deferred', entityType: 'User', entityId: userId, after: { reasons } });
      }
      return { status: 'deferred', reasons };
    }

    // Media files are deleted after the database work commits, so a failure can't leave rows pointing at nothing.
    const media = await this.prisma.mediaAsset.findMany({
      where: { ownerId: userId, partnerDocuments: { none: {} }, vendorDocuments: { none: {} } },
      select: { id: true },
    });
    const exports = await this.prisma.dataExport.findMany({ where: { userId, storageKey: { not: null } }, select: { storageKey: true } });

    const done = await this.prisma.$transaction(
      async (tx) => {
        // Claim the account: if they signed in a moment ago (which restores it), nothing is erased.
        const claimed = await tx.user.updateMany({ where: { id: userId, status: 'PENDING_DELETION' }, data: { status: 'DELETED' } });
        if (!claimed.count) return false;
        const now = new Date();

        // Social graph, keeping everyone else's counters right.
        const petFollows = await tx.petFollower.findMany({ where: { userId }, select: { petId: true } });
        for (const f of petFollows) await tx.pet.updateMany({ where: { id: f.petId, followerCount: { gt: 0 } }, data: { followerCount: { decrement: 1 } } });
        await tx.petFollower.deleteMany({ where: { userId } });
        await tx.userFollower.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } });
        await tx.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
        const likes = await tx.postLike.findMany({ where: { userId }, select: { postId: true } });
        for (const l of likes) await tx.post.updateMany({ where: { id: l.postId, likeCount: { gt: 0 } }, data: { likeCount: { decrement: 1 } } });
        await tx.postLike.deleteMany({ where: { userId } });
        const saves = await tx.postSave.findMany({ where: { userId }, select: { postId: true } });
        for (const s of saves) await tx.post.updateMany({ where: { id: s.postId, saveCount: { gt: 0 } }, data: { saveCount: { decrement: 1 } } });
        await tx.postSave.deleteMany({ where: { userId } });

        // Their comments on other people's posts.
        const comments = await tx.comment.findMany({ where: { authorId: userId, deletedAt: null }, select: { id: true, postId: true, parentId: true, status: true } });
        for (const c of comments) {
          if (c.status === 'VISIBLE') {
            await tx.post.updateMany({ where: { id: c.postId, commentCount: { gt: 0 } }, data: { commentCount: { decrement: 1 } } });
            if (c.parentId) await tx.comment.updateMany({ where: { id: c.parentId, replyCount: { gt: 0 } }, data: { replyCount: { decrement: 1 } } });
          }
        }
        await tx.comment.updateMany({ where: { authorId: userId }, data: { body: '', status: 'REMOVED', deletedAt: now } });

        // Their posts.
        const posts = await tx.post.findMany({ where: { authorId: userId, deletedAt: null }, select: { id: true, hashtags: { select: { hashtagId: true } } } });
        for (const p of posts) {
          const ids = p.hashtags.map((h) => h.hashtagId);
          if (ids.length) await tx.hashtag.updateMany({ where: { id: { in: ids }, postCount: { gt: 0 } }, data: { postCount: { decrement: 1 } } });
        }
        await tx.post.updateMany({ where: { authorId: userId }, data: { caption: null, locationName: null, latitude: null, longitude: null, status: 'REMOVED', deletedAt: now } });
        await tx.postMedia.deleteMany({ where: { post: { authorId: userId } } });

        // Pets: kept only as names on past contest results; private details go.
        await tx.pet.updateMany({
          where: { ownerId: userId },
          data: {
            status: 'REMOVED', deletedAt: now, visibility: 'PRIVATE', avatarUrl: null, coverUrl: null, about: null, personality: [], dateOfBirth: null,
            weightKg: null, color: null, city: null, latitude: null, longitude: null, microchipId: null, medicalNotes: null,
          },
        });
        await tx.petVaccination.deleteMany({ where: { pet: { ownerId: userId } } });
        await tx.petMedia.deleteMany({ where: { pet: { ownerId: userId } } });
        await tx.petFollower.deleteMany({ where: { pet: { ownerId: userId } } });

        // Everything that only exists for the person.
        await tx.mediaAsset.deleteMany({ where: { id: { in: media.map((m) => m.id) } } });
        await tx.authIdentity.deleteMany({ where: { userId } });
        await tx.session.deleteMany({ where: { userId } });
        await tx.deviceToken.deleteMany({ where: { userId } });
        await tx.address.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { OR: [{ userId }, { actorId: userId }] } });
        await tx.notificationPreference.deleteMany({ where: { userId } });
        await tx.cartItem.deleteMany({ where: { userId } });
        await tx.assistantConversation.deleteMany({ where: { userId } });
        // Chats and support tickets they started go with them; what they wrote elsewhere (as a partner or seller)
        // stays in the other person's conversation as "removed".
        await tx.conversation.deleteMany({ where: { customerId: userId } });
        await tx.chatMessage.updateMany({ where: { senderId: userId }, data: { body: null, mediaId: null, refType: null, refId: null, clientId: null, status: 'REMOVED' } });
        await tx.interestEvent.deleteMany({ where: { userId } });
        await tx.recoDismissal.deleteMany({ where: { userId } });
        await tx.dataExport.deleteMany({ where: { userId } });
        await tx.accountRisk.deleteMany({ where: { userId } });
        // Phase 9d: the days they used the app go; memberships stay with their payments (financial records), ended.
        await tx.userActivity.deleteMany({ where: { userId } });
        await tx.membership.updateMany({ where: { userId, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } }, data: { status: 'REVOKED', note: 'Account deleted' } });
        await tx.report.updateMany({ where: { reporterId: userId }, data: { details: null, evidenceIds: [] } });
        // Reviews keep their stars (so ratings stay honest) but lose the words and photos; the name shows as "PetApp user".
        await tx.serviceReview.updateMany({ where: { customerId: userId }, data: { comment: null, photoIds: [] } });
        await tx.productReview.updateMany({ where: { customerId: userId }, data: { comment: null, photoIds: [] } });

        // Businesses close; their records stay for tax. Bank account numbers go (the last four digits stay on payouts).
        await tx.servicePartner.updateMany({ where: { userId }, data: { status: 'SUSPENDED', statusReason: 'Owner deleted their account' } });
        await tx.vendor.updateMany({ where: { userId }, data: { status: 'SUSPENDED', statusReason: 'Owner deleted their account' } });
        await tx.product.updateMany({ where: { vendor: { userId }, status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
        await tx.payoutAccount.updateMany({ where: { ownerId: userId }, data: { accountNumberEnc: null, status: 'DISABLED' } });

        // The profile itself. The row stays (orders, invoices and the ledger point at it) with nothing personal in it.
        await tx.user.update({
          where: { id: userId },
          data: {
            name: null, phone: null, email: null, passwordHash: null, avatarUrl: null, gender: null, dateOfBirth: null, city: null,
            phoneVerifiedAt: null, emailVerifiedAt: null, preferences: {}, marketingConsent: false, statusReason: 'Erased',
          },
        });
        await this.audit.log({ actorId: actorId ?? null, action: 'user.erased', entityType: 'User', entityId: userId, after: { posts: posts.length, media: media.length } }, tx);
        return true;
      },
      { timeout: 120_000 },
    );
    if (!done) return { status: 'skipped', reason: 'restored' };

    for (const m of media) {
      await this.storage.deletePrefix(originalKey(userId, m.id)).catch(() => undefined);
      await this.storage.deletePrefix(variantPrefix(m.id)).catch(() => undefined);
      await this.storage.deletePrefix(variantPrefix(m.id, true)).catch(() => undefined);
    }
    for (const e of exports) await this.storage.deletePrefix(e.storageKey!).catch(() => undefined);
    this.logger.log(`erased account ${userId}`);
    return { status: 'erased' };
  }
}
