import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, RequirePermissions } from '../../common/decorators/auth.decorators';
import { Paged, PaginationQuery } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

class AuditQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

@ApiTags('Admin · Audit')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  async list(@Query() q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      actorId: q.actorId,
      entityType: q.entityType,
      entityId: q.entityId,
      action: q.action,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.limit,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return Paged.of(items, total, q);
  }
}
