import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ANALYTICS_TABS, AnalyticsService, type AnalyticsTab } from './analytics.service';

export class AnalyticsQuery {
  @ApiPropertyOptional({ description: 'First day, India time (YYYY-MM-DD). Default: 29 days before the end.' })
  @IsOptional() @IsString() @MaxLength(10) from?: string;
  @ApiPropertyOptional({ description: 'Last day, inclusive (YYYY-MM-DD). Default: today.' })
  @IsOptional() @IsString() @MaxLength(10) to?: string;
}

/** Admin analytics (spec §55). Totals and averages only. */
@ApiTags('Admin · Analytics')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':tab')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  report(@Param('tab') tab: string, @Query() q: AnalyticsQuery) {
    if (!(ANALYTICS_TABS as readonly string[]).includes(tab)) throw new NotFoundException(`Choose one of: ${ANALYTICS_TABS.join(', ')}.`);
    return this.analytics.report(tab as AnalyticsTab, q.from, q.to);
  }
}
