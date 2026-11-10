import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config.service';
import { redisTls } from '../prisma/pg-connection';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: 2, enableOfflineQueue: true, ...redisTls(config.get('REDIS_CA_CERT')) });
    this.client.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
