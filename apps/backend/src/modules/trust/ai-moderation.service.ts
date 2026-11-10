import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '../../generated/prisma/client';
import type { ReportTarget } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../providers/storage/storage.service';
import { AI_PROVIDER, AiError, type AiProvider, type ModerationResult } from '../../providers/ai/ai.provider';
import { QueueService } from '../../queue/queue.service';
import type { ModeratableTarget } from '../../queue/queues';
import { AuditService } from '../audit/audit.service';
import type { MediaVariants } from '../media/media.rules';
import { PlatformService } from '../platform/platform.service';
import { SafetyService, openKey } from '../safety/safety.service';
import { SAME_PHOTO_DISTANCE, decide, isGenericHash, normaliseLabels, type LabelScore } from './trust.rules';

/** What is checked for one item: its words, its photos, who posted it, and what kind of thing it is. */
interface Content {
  ownerId: string | null;
  context: string;
  text: string;
  media: Array<{ id: string; ownerId: string; perceptualHash: string | null; variants: MediaVariants; createdAt: Date }>;
  /** Can a moderator hide it while reviewing? (People and contest entries are handled elsewhere.) */
  hideable: boolean;
}

/** One-letter-or-digit squash used to find the same text posted by several accounts (matches the SQL below). */
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * AI moderation assist (spec §33). Checks new and changed content, stores every result (labels, confidence, reason,
 * model and version), and opens a moderation case when the AI is confident enough. It never removes anything: a moderator
 * decides. Optional: hide the item while it waits (a setting, off by default; reversible).
 */
@Injectable()
export class AiModerationService {
  private readonly logger = new Logger(AiModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
    private readonly safety: SafetyService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  /**
   * Checks one item. Returns what happened. Throws on a retryable provider failure unless this is the last attempt,
   * so the queue tries again later; on the last attempt an ERROR result is stored instead.
   */
  async assess(targetType: ModeratableTarget, targetId: string, opts: { lastAttempt?: boolean; force?: boolean } = {}): Promise<string> {
    if (!opts.force && !(await this.platform.getSetting<boolean>('ai.moderationEnabled'))) return 'disabled';
    const content = await this.load(targetType, targetId);
    if (!content) return 'gone';
    const maxImages = await this.platform.getSetting<number>('ai.maxImages');
    const media = content.media.slice(0, maxImages);
    const inputHash = createHash('sha256')
      .update(JSON.stringify([targetType, content.text, media.map((m) => m.id)]))
      .digest('hex');
    if (!opts.force && (await this.prisma.aiAssessment.findUnique({ where: { targetType_targetId_inputHash: { targetType, targetId, inputHash } } }))) return 'unchanged';

    // Our own checks first: copies of someone else's photos, and the same text from many accounts.
    const own = await this.duplicates(targetType, content, media);

    let result: ModerationResult | null = null;
    let error: string | null = null;
    const started = Date.now();
    if (content.text.trim() || media.length) {
      try {
        const urls = (await Promise.all(media.map((m) => this.imageUrl(m.variants)))).filter((u): u is string => !!u);
        result = await this.provider.moderate({ kind: targetType, context: content.context, text: content.text, imageUrls: urls });
      } catch (e) {
        const retryable = e instanceof AiError ? e.retryable : true;
        if (retryable && !opts.lastAttempt) throw e;
        error = (e as Error).message.slice(0, 500);
        this.logger.warn(`AI check of ${targetType} ${targetId} failed: ${error}`);
      }
    }

    const labels = normaliseLabels([...(result?.labels ?? []), ...own.labels]);
    const flagPct = await this.platform.getSetting<number>('ai.flagPct');
    const d = decide(labels, flagPct);
    const reason = [own.reasons.join(' '), result?.reason].filter((x) => x && x !== 'No rule matched.').join(' ') || (error ? 'The AI check failed; only PetApp’s own checks ran.' : 'Nothing found.');
    const verdict = d.flagged ? 'FLAGGED' : error && !own.labels.length ? 'ERROR' : 'CLEAR';

    let assessmentId: string;
    try {
      const a = await this.prisma.aiAssessment.create({
        data: {
          targetType, targetId, ownerId: content.ownerId, inputHash: opts.force ? createHash('sha256').update(`${inputHash}:${Date.now()}`).digest('hex') : inputHash,
          verdict, labels: labels as unknown as Prisma.InputJsonValue, topLabel: d.topLabel, confidence: d.confidence, reason: reason.slice(0, 1000),
          provider: this.provider.name, model: result?.model ?? (error ? 'unavailable' : 'petapp-checks'), version: result?.version ?? '1',
          latencyMs: Date.now() - started, error,
        },
      });
      assessmentId = a.id;
    } catch (e) {
      // A concurrent job checked the same content.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'unchanged';
      throw e;
    }
    if (!d.flagged) return verdict.toLowerCase();

    // Flagged: open a case (or raise the open one) for a moderator. Optionally hide while it waits.
    const autoHidePct = await this.platform.getSetting<number>('ai.autoHidePct');
    const hide = content.hideable && autoHidePct > 0 && d.confidence * 100 >= autoHidePct;
    const key = openKey(targetType as ReportTarget, targetId);
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const kase = await tx.moderationCase.upsert({
        where: { openKey: key },
        update: { aiAssessmentId: assessmentId, aiFlaggedAt: now },
        create: { targetType, targetId, openKey: key, reportCount: 0, lastReportedAt: now, aiAssessmentId: assessmentId, aiFlaggedAt: now },
      });
      await this.audit.log({ actorId: null, action: 'moderation.ai_flag', entityType: targetType, entityId: targetId, after: { caseId: kase.id, label: d.topLabel, confidence: d.confidence, assessmentId } }, tx);
      if (hide && (await this.safety.setContentState(tx, targetType as ReportTarget, targetId, 'HIDDEN', 'Hidden while PetApp reviews it'))) {
        await this.audit.log({ actorId: null, action: 'moderation.auto_hide', entityType: targetType, entityId: targetId, after: { caseId: kase.id, by: 'ai', confidence: d.confidence } }, tx);
      }
    });
    if (content.ownerId) this.queue.scoreRisk(content.ownerId);
    return 'flagged';
  }

  /** The newest checks of one item, for moderators. */
  history(targetType: ReportTarget, targetId: string, take = 5) {
    return this.prisma.aiAssessment.findMany({ where: { targetType, targetId }, orderBy: { createdAt: 'desc' }, take });
  }

  get providerInfo() {
    return { provider: this.provider.name, usesModel: this.provider.usesModel };
  }

  // ───────────── loading content ─────────────

  private async media(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.mediaAsset.findMany({ where: { id: { in: ids }, status: 'READY' }, select: { id: true, ownerId: true, perceptualHash: true, variants: true, createdAt: true } });
    // Keep the item's own order.
    return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ ...r, variants: (r.variants ?? {}) as MediaVariants }));
  }

  private async load(type: ModeratableTarget, id: string): Promise<Content | null> {
    switch (type) {
      case 'POST': {
        const p = await this.prisma.post.findFirst({ where: { id, deletedAt: null, status: { in: ['PUBLISHED', 'HIDDEN'] } }, include: { media: { orderBy: { position: 'asc' }, select: { mediaId: true } } } });
        if (!p) return null;
        return { ownerId: p.authorId, context: p.type === 'REEL' ? 'video reel (poster frame)' : 'photo post', text: p.caption ?? '', media: await this.media(p.media.map((m) => m.mediaId)), hideable: true };
      }
      case 'COMMENT': {
        const c = await this.prisma.comment.findFirst({ where: { id, deletedAt: null, status: { not: 'REMOVED' } } });
        return c ? { ownerId: c.authorId, context: 'comment on a post', text: c.body, media: [], hideable: true } : null;
      }
      case 'PET': {
        const p = await this.prisma.pet.findFirst({ where: { id, deletedAt: null, status: { not: 'REMOVED' } } });
        return p ? { ownerId: p.ownerId, context: 'pet profile (name and about)', text: [p.name, p.about].filter(Boolean).join('\n'), media: [], hideable: true } : null;
      }
      case 'USER': {
        const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
        return u ? { ownerId: u.id, context: 'person’s display name', text: u.name ?? '', media: [], hideable: false } : null;
      }
      case 'PRODUCT': {
        const p = await this.prisma.product.findUnique({ where: { id }, include: { vendor: { select: { userId: true } } } });
        if (!p || p.status === 'BLOCKED') return null;
        return { ownerId: p.vendor.userId, context: 'product listing in the shop', text: [p.title, p.brand, p.description].filter(Boolean).join('\n'), media: await this.media(p.imageIds), hideable: true };
      }
      case 'SERVICE_REVIEW': {
        const r = await this.prisma.serviceReview.findUnique({ where: { id } });
        return r && (r.comment || r.photoIds.length) ? { ownerId: r.customerId, context: `customer review of a pet-care service (${r.rating} of 5 stars)`, text: r.comment ?? '', media: await this.media(r.photoIds), hideable: true } : null;
      }
      case 'PRODUCT_REVIEW': {
        const r = await this.prisma.productReview.findUnique({ where: { id }, include: { product: { select: { title: true } } } });
        return r && (r.comment || r.photoIds.length) ? { ownerId: r.customerId, context: `customer review of a product bought in the shop, “${r.product.title}” (${r.rating} of 5 stars)`, text: r.comment ?? '', media: await this.media(r.photoIds), hideable: true } : null;
      }
      case 'CHAT_MESSAGE': {
        const m = await this.prisma.chatMessage.findUnique({ where: { id }, include: { conversation: { select: { kind: true } } } });
        if (!m || m.status !== 'VISIBLE' || m.internal || (m.side !== 'CUSTOMER' && m.side !== 'BUSINESS')) return null;
        const who = m.conversation.kind === 'SUPPORT' ? 'to PetApp support' : m.side === 'CUSTOMER' ? `from a customer to a ${m.conversation.kind === 'SHOP' ? 'seller' : 'pet-care business'}` : `from a ${m.conversation.kind === 'SHOP' ? 'seller' : 'pet-care business'} to a customer`;
        return { ownerId: m.senderId, context: `private chat message ${who}`, text: m.body ?? '', media: m.mediaId ? await this.media([m.mediaId]) : [], hideable: true };
      }
      case 'CONTEST_ENTRY': {
        const e = await this.prisma.contestParticipant.findUnique({
          where: { id },
          include: { contest: { select: { title: true } }, submissions: { include: { task: { select: { title: true } } } } },
        });
        if (!e || e.status === 'WITHDRAWN' || e.status === 'DISQUALIFIED') return null;
        const postIds = e.submissions.map((s) => s.postId).filter((x): x is string => !!x);
        const posts = postIds.length
          ? await this.prisma.post.findMany({ where: { id: { in: postIds } }, select: { id: true, caption: true, media: { orderBy: { position: 'asc' }, select: { mediaId: true } } } })
          : [];
        const text = e.submissions.map((s) => `${s.task.title}: ${s.text ?? posts.find((p) => p.id === s.postId)?.caption ?? ''}`).join('\n');
        const media = await this.media(postIds.flatMap((pid) => posts.find((p) => p.id === pid)?.media.map((m) => m.mediaId) ?? []));
        return { ownerId: e.userId, context: `contest entry for "${e.contest.title.slice(0, 80)}"`, text, media, hideable: false };
      }
    }
  }

  private async imageUrl(v: MediaVariants): Promise<string | null> {
    // A mid-size copy is enough to judge a photo and keeps the request small.
    const img = v.images?.find((i) => i.width >= 640) ?? v.images?.[v.images.length - 1];
    const key = img?.key ?? v.poster;
    if (!key) return null;
    return (key.startsWith('private/') ? this.storage.privateMediaUrl(key, 600) : this.storage.url(key)).catch(() => null);
  }

  // ───────────── PetApp's own checks ─────────────

  private async duplicates(type: ModeratableTarget, c: Content, media: Content['media']): Promise<{ labels: LabelScore[]; reasons: string[] }> {
    const labels: LabelScore[] = [];
    const reasons: string[] = [];
    // The same photo uploaded earlier by someone else. Product photos are often the maker's own pictures, so they score low.
    let copies = 0;
    for (const m of media) {
      // Photos sent in a chat are often someone else's pictures being shown (a product, a pet): never "copies".
      if (type === 'CHAT_MESSAGE') break;
      if (!m.perceptualHash || isGenericHash(m.perceptualHash) || !c.ownerId) continue;
      const [hit] = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "MediaAsset"
        WHERE "perceptualHash" IS NOT NULL AND NOT "private" AND "ownerId" <> ${c.ownerId}::uuid AND "createdAt" < ${m.createdAt}
          AND bit_count(('x' || "perceptualHash")::bit(64) # ('x' || ${m.perceptualHash})::bit(64)) <= ${SAME_PHOTO_DISTANCE}
        LIMIT 1`;
      if (hit) copies++;
    }
    if (copies) {
      const score = type === 'CONTEST_ENTRY' ? 0.9 : type === 'PRODUCT' ? 0.4 : 0.6;
      labels.push({ label: 'DUPLICATE', score });
      if (type === 'CONTEST_ENTRY') labels.push({ label: 'SUSPICIOUS_ENTRY', score: 0.85 });
      reasons.push(`${copies} photo${copies === 1 ? ' was' : 's were'} uploaded earlier by someone else.`);
    }
    // The same words from several other accounts this week (copy-paste spam).
    const words = squash(c.text);
    if ((type === 'COMMENT' || type === 'POST') && words.length >= 20 && c.ownerId) {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const [{ n }] =
        type === 'COMMENT'
          ? await this.prisma.$queryRaw<Array<{ n: bigint }>>`
              SELECT COUNT(DISTINCT "authorId") AS n FROM "Comment"
              WHERE "createdAt" >= ${since} AND "authorId" <> ${c.ownerId}::uuid AND lower(regexp_replace(body, '[^[:alnum:]]+', '', 'g')) = ${words}`
          : await this.prisma.$queryRaw<Array<{ n: bigint }>>`
              SELECT COUNT(DISTINCT "authorId") AS n FROM "Post"
              WHERE "createdAt" >= ${since} AND "authorId" <> ${c.ownerId}::uuid AND caption IS NOT NULL AND lower(regexp_replace(caption, '[^[:alnum:]]+', '', 'g')) = ${words}`;
      const others = Number(n);
      if (others >= 2) {
        labels.push({ label: 'SPAM', score: others >= 5 ? 0.9 : 0.75 });
        reasons.push(`The same text was posted by ${others} other accounts this week.`);
      }
    }
    return { labels, reasons };
  }
}
