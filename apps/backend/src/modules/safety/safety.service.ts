import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import type { ReportTarget } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import type { CreateReportDto } from './safety.dto';
import { recomputePartnerRating, recomputeProductRating } from '../reviews/ratings';
import { REPORT_EVIDENCE_MAX } from '../reviews/reviews.rules';

export const openKey = (type: ReportTarget, id: string) => `${type}:${id}`;

@Injectable()
export class SafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platform: PlatformService,
  ) {}

  // ───────────── blocking ─────────────

  /** Blocking removes follows in both directions (people and their pets) and hides each from the other. */
  async block(me: string, other: string) {
    if (me === other) throw new BadRequestException('You can’t block yourself.');
    if (!(await this.prisma.user.findUnique({ where: { id: other }, select: { id: true } }))) throw new NotFoundException('User not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.block.createMany({ data: [{ blockerId: me, blockedId: other }], skipDuplicates: true });
      await tx.userFollower.deleteMany({ where: { OR: [{ followerId: me, followingId: other }, { followerId: other, followingId: me }] } });
      const petFollows = await tx.petFollower.findMany({
        where: { OR: [{ userId: me, pet: { ownerId: other } }, { userId: other, pet: { ownerId: me } }] },
        select: { userId: true, petId: true },
      });
      for (const f of petFollows) {
        await tx.petFollower.delete({ where: { userId_petId: f } });
        await tx.pet.update({ where: { id: f.petId }, data: { followerCount: { decrement: 1 } } });
      }
    });
    return { blocked: true };
  }

  async unblock(me: string, other: string) {
    await this.prisma.block.deleteMany({ where: { blockerId: me, blockedId: other } });
    return { blocked: false };
  }

  blocks(me: string) {
    return this.prisma.block
      .findMany({ where: { blockerId: me }, orderBy: { createdAt: 'desc' }, include: { blocked: { select: { id: true, name: true, avatarUrl: true } } } })
      .then((rows) => rows.map((r) => ({ ...r.blocked, blockedAt: r.createdAt })));
  }

  async isBlockedEitherWay(a: string | undefined, b: string): Promise<boolean> {
    if (!a || a === b) return false;
    return (await this.prisma.block.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) > 0;
  }

  // ───────────── reporting ─────────────

  /** Owner of the reported thing — used to stop self-reports and to suspend the right person. */
  async targetOwner(type: ReportTarget, id: string): Promise<string | null> {
    switch (type) {
      case 'USER':
        return (await this.prisma.user.findUnique({ where: { id }, select: { id: true } }))?.id ?? null;
      case 'PET':
        return (await this.prisma.pet.findFirst({ where: { id, deletedAt: null }, select: { ownerId: true } }))?.ownerId ?? null;
      case 'POST':
        return (await this.prisma.post.findFirst({ where: { id, deletedAt: null }, select: { authorId: true } }))?.authorId ?? null;
      case 'COMMENT':
        return (await this.prisma.comment.findFirst({ where: { id, deletedAt: null }, select: { authorId: true } }))?.authorId ?? null;
      case 'PRODUCT':
        return (await this.prisma.product.findUnique({ where: { id }, select: { vendor: { select: { userId: true } } } }))?.vendor.userId ?? null;
      case 'SERVICE_REVIEW':
        return (await this.prisma.serviceReview.findUnique({ where: { id }, select: { customerId: true } }))?.customerId ?? null;
      case 'CONTEST_ENTRY':
        return (await this.prisma.contestParticipant.findUnique({ where: { id }, select: { userId: true } }))?.userId ?? null;
      case 'CHAT_MESSAGE':
        return (await this.prisma.chatMessage.findFirst({ where: { id, internal: false }, select: { senderId: true } }))?.senderId ?? null;
      case 'SERVICE_PARTNER':
        return (await this.prisma.servicePartner.findUnique({ where: { id }, select: { userId: true } }))?.userId ?? null;
      case 'PRODUCT_REVIEW':
        return (await this.prisma.productReview.findUnique({ where: { id }, select: { customerId: true } }))?.customerId ?? null;
      default:
        return null;
    }
  }

  /** Private things can only be reported by someone who can see them: a chat message by the people in its conversation. */
  private async canReport(reporterId: string, type: ReportTarget, id: string): Promise<boolean> {
    // A business page can be reported while it's public.
    if (type === 'SERVICE_PARTNER') return (await this.prisma.servicePartner.count({ where: { id, status: 'APPROVED' } })) > 0;
    if (type !== 'CHAT_MESSAGE') return true;
    const m = await this.prisma.chatMessage.findFirst({
      where: { id, internal: false },
      select: { conversation: { select: { customerId: true, partner: { select: { userId: true } }, vendor: { select: { userId: true } } } } },
    });
    const c = m?.conversation;
    return !!c && (c.customerId === reporterId || c.partner?.userId === reporterId || c.vendor?.userId === reporterId);
  }

  async report(reporterId: string, dto: CreateReportDto) {
    const owner = await this.targetOwner(dto.targetType, dto.targetId);
    if (!owner || !(await this.canReport(reporterId, dto.targetType, dto.targetId))) throw new NotFoundException('We couldn’t find what you’re reporting.');
    if (owner === reporterId) throw new BadRequestException('You can’t report your own content.');
    const exists = await this.prisma.report.findUnique({
      where: { reporterId_targetType_targetId: { reporterId, targetType: dto.targetType, targetId: dto.targetId } },
    });
    if (exists) throw new ConflictException('You’ve already reported this. Our team will review it.');
    const evidenceIds = await this.assertEvidence(reporterId, dto.evidenceIds);

    const key = openKey(dto.targetType, dto.targetId);
    const threshold = await this.platform.getSetting<number>('reports.autoHideThreshold');
    return this.prisma.$transaction(async (tx) => {
      const kase = await tx.moderationCase.upsert({
        where: { openKey: key },
        update: { reportCount: { increment: 1 }, lastReportedAt: new Date() },
        create: { targetType: dto.targetType, targetId: dto.targetId, openKey: key, reportCount: 1 },
      });
      const report = await tx.report.create({
        data: { reporterId, targetType: dto.targetType, targetId: dto.targetId, reason: dto.reason, details: dto.details, evidenceIds, caseId: kase.id },
      });
      if (threshold > 0 && kase.reportCount >= threshold && dto.targetType !== 'USER' && dto.targetType !== 'SERVICE_PARTNER') {
        if (await this.setContentState(tx, dto.targetType, dto.targetId, 'HIDDEN')) {
          await this.audit.log({ actorId: null, action: 'moderation.auto_hide', entityType: dto.targetType, entityId: dto.targetId, after: { caseId: kase.id, reports: kase.reportCount } }, tx);
        }
      }
      return { id: report.id, status: 'received' };
    });
  }

  /** Evidence is private: the reporter's own finished private photo uploads (screenshots). Only moderators see it. */
  private async assertEvidence(userId: string, ids: string[] | undefined): Promise<string[]> {
    const unique = [...new Set(ids ?? [])];
    if (unique.length > REPORT_EVIDENCE_MAX) throw new BadRequestException(`Attach up to ${REPORT_EVIDENCE_MAX} screenshots.`);
    if (!unique.length) return [];
    const ok = await this.prisma.mediaAsset.count({ where: { id: { in: unique }, ownerId: userId, kind: 'IMAGE', status: 'READY', private: true } });
    if (ok !== unique.length) throw new BadRequestException('Attach screenshots you uploaded for this report.');
    return unique;
  }

  /**
   * Moves content between visible / hidden / removed. Keeps post comment counts right.
   * Returns true when something changed.
   */
  async setContentState(tx: Prisma.TransactionClient, type: ReportTarget, id: string, state: 'VISIBLE' | 'HIDDEN' | 'REMOVED', note?: string): Promise<boolean> {
    if (type === 'PRODUCT') {
      // Hidden or removed listings are blocked (the seller sees the note); restoring returns them to the seller unlisted.
      if (state === 'VISIBLE') return (await tx.product.updateMany({ where: { id, status: 'BLOCKED' }, data: { status: 'INACTIVE', blockReason: null } })).count > 0;
      return (await tx.product.updateMany({ where: { id, status: { not: 'BLOCKED' } }, data: { status: 'BLOCKED', blockReason: note ?? 'Hidden while PetApp reviews it' } })).count > 0;
    }
    if (type === 'CHAT_MESSAGE') {
      const to = state;
      return (await tx.chatMessage.updateMany({ where: { id, status: { not: to } }, data: { status: to } })).count > 0;
    }
    // Reviews have no "removed": both hide it. The rating follows in the same transaction.
    if (type === 'SERVICE_REVIEW') {
      const to = state === 'VISIBLE' ? 'VISIBLE' : 'HIDDEN';
      const r = await tx.serviceReview.findUnique({ where: { id }, select: { partnerId: true } });
      if (!r || (await tx.serviceReview.updateMany({ where: { id, status: { not: to } }, data: { status: to } })).count === 0) return false;
      await recomputePartnerRating(tx, r.partnerId);
      return true;
    }
    if (type === 'PRODUCT_REVIEW') {
      const to = state === 'VISIBLE' ? 'VISIBLE' : 'HIDDEN';
      const r = await tx.productReview.findUnique({ where: { id }, select: { productId: true } });
      if (!r || (await tx.productReview.updateMany({ where: { id, status: { not: to } }, data: { status: to } })).count === 0) return false;
      await recomputeProductRating(tx, r.productId);
      return true;
    }
    if (type === 'POST') {
      const to = state === 'VISIBLE' ? 'PUBLISHED' : state;
      const from = state === 'VISIBLE' ? ['HIDDEN'] : state === 'HIDDEN' ? ['PUBLISHED'] : ['PUBLISHED', 'HIDDEN'];
      return (await tx.post.updateMany({ where: { id, status: { in: from as never[] } }, data: { status: to as never } })).count > 0;
    }
    if (type === 'PET') {
      const to = state === 'VISIBLE' ? 'ACTIVE' : state;
      const from = state === 'VISIBLE' ? ['HIDDEN'] : state === 'HIDDEN' ? ['ACTIVE'] : ['ACTIVE', 'HIDDEN'];
      return (await tx.pet.updateMany({ where: { id, status: { in: from as never[] } }, data: { status: to as never } })).count > 0;
    }
    if (type === 'COMMENT') {
      const cm = await tx.comment.findUnique({ where: { id }, select: { status: true, postId: true, parentId: true } });
      if (!cm || cm.status === state || cm.status === 'REMOVED') return false;
      await tx.comment.update({ where: { id }, data: { status: state } });
      const delta = cm.status === 'VISIBLE' ? -1 : state === 'VISIBLE' ? 1 : 0;
      if (delta) {
        await tx.post.update({ where: { id: cm.postId }, data: { commentCount: { increment: delta } } });
        if (cm.parentId) await tx.comment.update({ where: { id: cm.parentId }, data: { replyCount: { increment: delta } } });
      }
      return true;
    }
    return false;
  }
}
