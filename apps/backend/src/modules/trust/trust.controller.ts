import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { Paged } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import type { Prisma } from '../../generated/prisma/client';
import { AiModerationService } from './ai-moderation.service';
import { RiskService } from './risk.service';
import { AssessDto, AssessmentsQuery, RiskQuery, RiskReviewDto } from './trust.dto';

@ApiTags('Admin · Trust & safety')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin')
export class TrustController {
  constructor(
    private readonly ai: AiModerationService,
    private readonly risk: RiskService,
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
  ) {}

  /** Which AI provider checks content, and the current thresholds. */
  @Get('ai/status') @RequirePermissions(PERMISSIONS.CONTENT_READ) async status() {
    const s = <T>(k: string) => this.platform.getSetting<T>(k);
    const since = new Date(Date.now() - 86_400_000);
    const last24h = await this.prisma.aiAssessment.groupBy({ by: ['verdict'], where: { createdAt: { gte: since } }, _count: { _all: true } });
    return {
      ...this.ai.providerInfo,
      enabled: await s<boolean>('ai.moderationEnabled'),
      flagPct: await s<number>('ai.flagPct'),
      autoHidePct: await s<number>('ai.autoHidePct'),
      last24h: Object.fromEntries(last24h.map((x) => [x.verdict, x._count._all])),
    };
  }

  /** Every AI check, newest first: result, confidence, reason, model and version. */
  @Get('ai/assessments') @RequirePermissions(PERMISSIONS.CONTENT_READ) async assessments(@Query() q: AssessmentsQuery) {
    const where: Prisma.AiAssessmentWhereInput = { verdict: q.verdict, targetType: q.targetType };
    const [items, total] = await Promise.all([
      this.prisma.aiAssessment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit }),
      this.prisma.aiAssessment.count({ where }),
    ]);
    return Paged.of(items, total, q);
  }

  /** Check an item again now (e.g. after changing the provider or thresholds). */
  @Post('ai/assess') @HttpCode(200) @RequirePermissions(PERMISSIONS.CONTENT_MODERATE) async assess(@Body() dto: AssessDto) {
    const outcome = await this.ai.assess(dto.targetType, dto.targetId, { force: true, lastAttempt: true });
    const [latest] = await this.ai.history(dto.targetType, dto.targetId, 1);
    return { outcome, assessment: latest ?? null };
  }

  /** Accounts by fraud risk. Default: high-risk accounts waiting for a staff review. */
  @Get('risk') @RequirePermissions(PERMISSIONS.USERS_READ) list(@Query() q: RiskQuery) {
    return this.risk.list(q);
  }

  @Get('risk/:userId') @RequirePermissions(PERMISSIONS.USERS_READ) detail(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.risk.detail(userId);
  }

  /** Recompute the score now. */
  @Post('risk/:userId/recompute') @HttpCode(200) @RequirePermissions(PERMISSIONS.USERS_READ) async recompute(@Param('userId', ParseUUIDPipe) userId: string) {
    await this.risk.score(userId);
    return this.risk.detail(userId);
  }

  /**
   * Record that staff looked at the account and what they concluded. This doesn't change the account: suspending is a
   * separate, deliberate action on the person's page.
   */
  @Post('risk/:userId/review') @HttpCode(200) @RequirePermissions(PERMISSIONS.USERS_SUSPEND) review(@CurrentUser() me: Principal, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: RiskReviewDto) {
    return this.risk.review(me.userId, userId, dto.note);
  }
}
