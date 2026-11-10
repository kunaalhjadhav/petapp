import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { RedisService } from '../../redis/redis.service';
import type { ChatEvent } from './chat.rules';

const CHANNEL = 'chat:events';
const TICKET_TTL = 60;
/** Presence lasts this long without a heartbeat (the gateway refreshes it every 25 seconds). */
export const PRESENCE_TTL = 60;

/**
 * Realtime plumbing shared by every API instance:
 * - one-time tickets to open a WebSocket, so access tokens never appear in URLs or server logs
 * - who is connected (to skip push notifications for people looking at the app)
 * - fan-out: an event published by any instance reaches the people's sockets on every instance (Redis pub/sub)
 */
@Injectable()
export class ChatRealtime implements OnModuleDestroy {
  private readonly logger = new Logger(ChatRealtime.name);
  private sub: Redis | null = null;
  private readonly listeners = new Set<(userIds: string[], event: ChatEvent) => void>();

  constructor(private readonly redis: RedisService) {}

  async issueTicket(userId: string): Promise<string> {
    const ticket = randomBytes(24).toString('base64url');
    await this.redis.client.set(`chat:ticket:${ticket}`, userId, 'EX', TICKET_TTL);
    return ticket;
  }

  /** Uses a ticket up. Returns its user, or null if it's unknown, expired or already used. */
  async redeemTicket(ticket: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(ticket)) return null;
    return this.redis.client.getdel(`chat:ticket:${ticket}`);
  }

  async markOnline(userId: string): Promise<void> {
    await this.redis.client.set(`chat:online:${userId}`, '1', 'EX', PRESENCE_TTL);
  }

  async markOffline(userId: string): Promise<void> {
    await this.redis.client.del(`chat:online:${userId}`);
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.client.exists(`chat:online:${userId}`)) === 1;
  }

  /** Sends an event to these people's open apps, wherever they're connected. Never throws. */
  publish(userIds: string[], event: ChatEvent): void {
    const to = [...new Set(userIds)].filter(Boolean);
    if (!to.length) return;
    this.redis.client.publish(CHANNEL, JSON.stringify({ to, event })).catch((e) => this.logger.warn(`publish failed: ${(e as Error).message}`));
  }

  /** The gateway's subscription. Opens the Redis subscriber on first use. */
  async subscribe(fn: (userIds: string[], event: ChatEvent) => void): Promise<() => void> {
    this.listeners.add(fn);
    if (!this.sub) {
      this.sub = this.redis.client.duplicate();
      this.sub.on('message', (_ch, raw) => {
        try {
          const { to, event } = JSON.parse(raw) as { to: string[]; event: ChatEvent };
          for (const l of this.listeners) l(to, event);
        } catch (e) {
          this.logger.warn(`bad chat event: ${(e as Error).message}`);
        }
      });
      await this.sub.subscribe(CHANNEL);
    }
    return () => this.listeners.delete(fn);
  }

  async onModuleDestroy() {
    await this.sub?.quit().catch(() => undefined);
  }
}
