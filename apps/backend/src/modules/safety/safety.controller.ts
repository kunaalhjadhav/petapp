import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, RequestMeta, RequirePermissions, type RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { SafetyService } from './safety.service';
import { ModerationService } from './moderation.service';
import { CasesQuery, CreateReportDto, ReportsQuery, ResolveCaseDto } from './safety.dto';

@ApiTags('Safety')
@ApiBearerAuth()
@Controller()
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Get('users/me/blocks')
  blocks(@CurrentUser() me: Principal) {
    return this.safety.blocks(me.userId);
  }

  @Post('users/:id/block')
  @HttpCode(200)
  block(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.safety.block(me.userId, id);
  }

  @Delete('users/:id/block')
  unblock(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.safety.unblock(me.userId, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reports')
  report(@CurrentUser() me: Principal, @Body() dto: CreateReportDto) {
    return this.safety.report(me.userId, dto);
  }
}

@ApiTags('Admin · Moderation')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/moderation/cases')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CONTENT_READ)
  list(@Query() q: CasesQuery) {
    return this.moderation.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CONTENT_READ)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.detail(id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTENT_MODERATE)
  resolve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveCaseDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.moderation.resolve(me, id, dto, meta);
  }
}

@ApiTags('Admin · Moderation')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/moderation/reports')
export class ReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CONTENT_READ)
  list(@Query() q: ReportsQuery) {
    return this.moderation.reports(q);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.CONTENT_READ)
  summary() {
    return this.moderation.reportsSummary();
  }
}
