import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, Public, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { MembershipsService } from './memberships.service';
import { GrantDto, MembersQuery, PlanDto, PurchaseDto, RevokeDto, UpdatePlanDto } from './memberships.dto';

/** Membership plans in the app (spec §40). Off unless ENABLE_MEMBERSHIPS is on. */
@ApiTags('Memberships')
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Public()
  @Get('plans')
  plans() {
    return this.memberships.plans();
  }

  @ApiBearerAuth()
  @Get('me')
  mine(@CurrentUser() me: Principal) {
    return this.memberships.mine(me.userId);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('purchase')
  @HttpCode(201)
  purchase(@CurrentUser() me: Principal, @Body() dto: PurchaseDto) {
    return this.memberships.purchase(me.userId, dto.planId);
  }
}

@ApiTags('Admin · Memberships')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/memberships')
export class AdminMembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get('summary') @RequirePermissions(PERMISSIONS.MEMBERSHIPS_READ) summary() {
    return this.memberships.summary();
  }

  @Get('plans') @RequirePermissions(PERMISSIONS.MEMBERSHIPS_READ) plans() {
    return this.memberships.adminPlans();
  }

  @Post('plans') @RequirePermissions(PERMISSIONS.MEMBERSHIPS_MANAGE) createPlan(@CurrentUser() me: Principal, @Body() dto: PlanDto) {
    return this.memberships.createPlan(me.userId, dto);
  }

  @Patch('plans/:id') @RequirePermissions(PERMISSIONS.MEMBERSHIPS_MANAGE) updatePlan(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.memberships.updatePlan(me.userId, id, dto);
  }

  @Get('members') @RequirePermissions(PERMISSIONS.MEMBERSHIPS_READ) members(@Query() q: MembersQuery) {
    return this.memberships.members(q);
  }

  @Post('grant') @RequirePermissions(PERMISSIONS.MEMBERSHIPS_MANAGE) grant(@CurrentUser() me: Principal, @Body() dto: GrantDto) {
    return this.memberships.grant(me.userId, dto);
  }

  @Post(':id/revoke') @HttpCode(200) @RequirePermissions(PERMISSIONS.MEMBERSHIPS_MANAGE) revoke(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto) {
    return this.memberships.revoke(me.userId, id, dto.reason);
  }
}
