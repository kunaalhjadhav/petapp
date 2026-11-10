import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: RequestMetaInfo;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass `tx` to write the audit row in the same transaction as the change it records. */
  async log(entry: AuditEntry, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: entry.before === undefined ? Prisma.DbNull : (entry.before as Prisma.InputJsonValue),
        after: entry.after === undefined ? Prisma.DbNull : (entry.after as Prisma.InputJsonValue),
        ipAddress: entry.meta?.ip,
        userAgent: entry.meta?.userAgent?.slice(0, 500),
      },
    });
  }
}
