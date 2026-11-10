import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../../providers/storage/storage.service';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  /** Liveness: the process is up. */
  @Get('health')
  health() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: dependencies reachable. Returns 503 when not ready. */
  @Get('ready')
  async ready() {
    const check = async (fn: () => Promise<unknown>) => {
      const t = Date.now();
      try {
        await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))]);
        return { ok: true, ms: Date.now() - t };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    };
    const [database, redis, storage] = await Promise.all([
      check(() => this.prisma.$queryRaw`SELECT 1`),
      check(() => this.redis.client.ping()),
      this.storage.configured ? check(() => this.storage.ping()) : Promise.resolve({ ok: true, skipped: 'not configured' }),
    ]);
    const result = { status: database.ok && redis.ok && storage.ok ? 'ready' : 'not_ready', checks: { database, redis, storage } };
    if (result.status !== 'ready') throw new ServiceUnavailableException({ message: 'Service not ready', errors: [{ message: JSON.stringify(result.checks) }] });
    return result;
  }
}
