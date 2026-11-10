import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { AppConfig } from '../config/app-config.service';
import { pgConnection } from './pg-connection';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg(pgConnection(config.get('DATABASE_URL'), config.get('DATABASE_CA_CERT'))) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
