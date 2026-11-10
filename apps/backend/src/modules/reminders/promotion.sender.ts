import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import { PUSH_PROVIDER, type PushProvider } from '../../providers/push/push.provider';
import { renderNotification } from '../notifications/render';
import { Prisma } from '../../generated/prisma/client';
import { istStart, istDay } from '../analytics/analytics.rules';
import { promotionAudienceSql } from './promotions.service';

const BATCH = 500;

/**
 * Sends promotions that are due (worker, every minute). A promotion is claimed by one worker (QUEUED → SENDING),
 * then reaches its audience in batches: one row in each person's notifications, and a push if they allow push.
 * People who already had today's limit of promotions are skipped. Safe to resume after a crash: rows are unique per
 * person and promotion.
 */
@Injectable()
export class PromotionSender {
  private readonly logger = new Logger(PromotionSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async sendDue(now = new Date()): Promise<number> {
    // Also picks up one left SENDING by a worker that stopped more than 10 minutes ago.
    const due = await this.prisma.promotion.findMany({
      where: { OR: [{ status: 'QUEUED', sendAt: { lte: now } }, { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }] },
      orderBy: { sendAt: 'asc' }, take: 5,
    });
    let total = 0;
    for (const p of due) {
      const { count } = await this.prisma.promotion.updateMany({ where: { id: p.id, status: p.status, updatedAt: p.updatedAt }, data: { status: 'SENDING' } });
      if (!count) continue;
      const sent = await this.send(p.id, p.title, p.body, p.link, p.audience, p.city, now);
      const reached = await this.prisma.notification.count({ where: { type: 'PROMOTION', groupKey: `promo:${p.id}` } });
      await this.prisma.promotion.update({ where: { id: p.id }, data: { status: 'SENT', sentAt: new Date(), recipients: reached } });
      this.logger.log(`promotion ${p.id}: ${sent} new recipients (${reached} in all)`);
      total += sent;
    }
    return total;
  }

  private async send(id: string, title: string, body: string, link: string | null, audience: string, city: string | null, now: Date) {
    const limit = await this.platform.getSetting<number>('promotions.dailyLimit');
    const dayStart = istStart(istDay(now));
    const groupKey = `promo:${id}`;
    const data = { title, body, link } as Prisma.InputJsonValue;
    let after = '00000000-0000-0000-0000-000000000000';
    let sent = 0;
    for (;;) {
      const batch = await this.prisma.$queryRaw<Array<{ id: string; push: boolean }>>`
        SELECT u.id, np.push ${promotionAudienceSql(audience, city, now)}
          AND u.id > ${after}::uuid
          AND NOT EXISTS (SELECT 1 FROM "Notification" n WHERE n."userId" = u.id AND n."groupKey" = ${groupKey})
          AND (SELECT COUNT(*) FROM "Notification" n WHERE n."userId" = u.id AND n.type = 'PROMOTION' AND n."createdAt" >= ${dayStart}) < ${limit}
        ORDER BY u.id LIMIT ${BATCH}`;
      if (!batch.length) break;
      after = batch[batch.length - 1].id;
      await this.prisma.notification.createMany({
        data: batch.map((u) => ({ userId: u.id, type: 'PROMOTION' as const, entityType: 'Promotion', entityId: id, data, groupKey })),
        skipDuplicates: true,
      });
      sent += batch.length;
      const rows = await this.prisma.notification.findMany({ where: { groupKey, userId: { in: batch.filter((u) => u.push).map((u) => u.id) } }, select: { id: true, userId: true } });
      const devices = await this.prisma.deviceToken.findMany({ where: { userId: { in: rows.map((r) => r.userId) } }, select: { token: true, userId: true } });
      const text = renderNotification({ type: 'PROMOTION', count: 1, data: { title, body } });
      for (const d of devices) {
        const notificationId = rows.find((r) => r.userId === d.userId)!.id;
        const r = await this.push.send({ token: d.token, ...text, data: { notificationId, type: 'PROMOTION', entityType: 'Promotion', entityId: id, link: link ?? '' } });
        if (r === 'invalid-token') await this.prisma.deviceToken.deleteMany({ where: { token: d.token } });
      }
      if (batch.length < BATCH) break;
    }
    return sent;
  }
}
