import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PlatformService } from '../platform/platform.service';

/**
 * Nightly (worker): tickets marked resolved with no reply for support.autoCloseDays are closed, with a line in the
 * thread saying why. Kept apart from the support service so the worker doesn't load the chat module.
 */
@Injectable()
export class SupportAutoClose {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly redis: RedisService,
  ) {}

  async sweep(now = new Date()): Promise<number> {
    const days = await this.platform.getSetting<number>('support.autoCloseDays');
    if (days <= 0) return 0;
    const due = await this.prisma.supportTicket.findMany({
      where: { status: 'RESOLVED', resolvedAt: { lt: new Date(now.getTime() - days * 86_400_000) } },
      select: { id: true, userId: true, conversationId: true },
      take: 500,
    });
    const body = `This ticket was closed after ${days} days without a reply. Open a new one if you still need help.`;
    for (const t of due) {
      const closed = await this.prisma.$transaction(async (tx) => {
        const n = await tx.supportTicket.updateMany({ where: { id: t.id, status: 'RESOLVED' }, data: { status: 'CLOSED', closedAt: now } });
        if (!n.count) return false;
        const m = await tx.chatMessage.create({ data: { conversationId: t.conversationId, side: 'SYSTEM', body } });
        await tx.conversation.update({ where: { id: t.conversationId }, data: { status: 'CLOSED', lastMessageAt: m.createdAt, lastMessageText: body } });
        return true;
      });
      if (closed) await this.redis.client.publish('chat:events', JSON.stringify({ to: [t.userId], event: { type: 'conversation', conversationId: t.conversationId, status: 'CLOSED' } })).catch(() => undefined);
    }
    return due.length;
  }
}
