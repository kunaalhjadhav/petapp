import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';

/** Deletes PetApp Assistant conversations older than the retention period (run nightly by the worker). */
@Injectable()
export class AssistantRetention {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
  ) {}

  async purge(): Promise<number> {
    const days = await this.platform.getSetting<number>('assistant.historyDays');
    const r = await this.prisma.assistantConversation.deleteMany({ where: { lastMessageAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
    return r.count;
  }
}

@Global()
@Module({ providers: [AssistantRetention], exports: [AssistantRetention] })
export class AssistantRetentionModule {}
