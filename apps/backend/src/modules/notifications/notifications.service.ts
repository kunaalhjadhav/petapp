import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../posts/text';
import { renderNotification } from './render';
import type { PreferencesDto, RegisterDeviceDto } from './notifications.dto';

const DEFAULT_PREFS = { push: true, likes: true, comments: true, mentions: true, follows: true, posts: true, chat: true, reminders: true, votes: true, promotions: false };

/** Read side of notifications (the worker writes them). */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, cursorStr: string | undefined, limit: number) {
    const c = decodeCursor(cursorStr);
    const take = Math.min(limit, 50);
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(c ? { OR: [{ updatedAt: { lt: c.date } }, { updatedAt: c.date, id: { lt: c.id } }] } : {}) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: { actor: { select: { id: true, name: true, avatarUrl: true } } },
    });
    const more = rows.length > take;
    const items = rows.slice(0, take).map((n) => ({
      id: n.id,
      type: n.type,
      ...renderNotification({ type: n.type, actorName: n.actor?.name, count: n.count, data: n.data as Record<string, unknown> }),
      actor: n.actor,
      entityType: n.entityType,
      entityId: n.entityId,
      /** A page in the app to open (promotions); otherwise the app opens the entity. */
      link: n.type === 'PROMOTION' && typeof (n.data as Record<string, unknown>).link === 'string' ? ((n.data as Record<string, unknown>).link as string) : null,
      count: n.count,
      read: n.readAt !== null,
      at: n.updatedAt,
    }));
    return { items, nextCursor: more ? encodeCursor(rows[take - 1].updatedAt, rows[take - 1].id) : null, unread: await this.unread(userId) };
  }

  unread(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, ids?: string[]) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { marked: count, unread: await this.unread(userId) };
  }

  async preferences(userId: string) {
    const p = (await this.prisma.notificationPreference.findUnique({ where: { userId } })) ?? DEFAULT_PREFS;
    return {
      push: p.push, likes: p.likes, comments: p.comments, mentions: p.mentions, follows: p.follows, posts: p.posts, chat: p.chat,
      reminders: p.reminders, votes: p.votes, promotions: p.promotions,
    };
  }

  async setPreferences(userId: string, dto: PreferencesDto) {
    const before = await this.preferences(userId);
    await this.prisma.notificationPreference.upsert({ where: { userId }, update: dto, create: { userId, ...DEFAULT_PREFS, ...dto } });
    // Marketing consent is kept as evidence: when promotions were turned on or off, and by whom.
    if (dto.promotions !== undefined && dto.promotions !== before.promotions) {
      await this.audit.log({ actorId: userId, action: dto.promotions ? 'notifications.promotions_on' : 'notifications.promotions_off', entityType: 'User', entityId: userId });
    }
    return this.preferences(userId);
  }

  /** A token belongs to one account at a time: signing in on a shared phone moves it. */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      update: { userId, platform: dto.platform, appVersion: dto.appVersion, lastSeenAt: new Date() },
      create: { userId, token: dto.token, platform: dto.platform, appVersion: dto.appVersion },
    });
    return { registered: true };
  }

  async removeDevice(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { registered: false };
  }
}
