import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { PromotionsService } from './promotions.service';
import { AudienceQuery, PromotionDto, PromotionsQuery } from './promotions.dto';

@ApiTags('Admin · Promotions')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get() @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE) list(@Query() q: PromotionsQuery) {
    return this.promotions.list(q);
  }

  /** How many people a promotion would reach right now (only those who turned promotions on). */
  @Get('audience') @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE) audience(@Query() q: AudienceQuery) {
    return this.promotions.audienceSize(q.audience, q.city);
  }

  @Post() @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE) create(@CurrentUser() me: Principal, @Body() dto: PromotionDto) {
    return this.promotions.create(me.userId, dto);
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE) cancel(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotions.cancel(me.userId, id);
  }
}
