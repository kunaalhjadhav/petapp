import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, OptionalAuth, RequireFeature, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { ChallengesService } from './challenges.service';
import { AdminChallengesQuery, BadgeDto, BoardQuery, ChallengeDto, ChallengeStatusDto, CheckInDto, JoinDto, PublicChallengesQuery, UpdateChallengeDto } from './challenges.dto';

/** Challenges share the "Contests" feature switch. */
@ApiTags('Challenges')
@ApiBearerAuth()
@RequireFeature('ENABLE_CONTESTS')
@Controller()
export class ChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  @OptionalAuth()
  @Get('challenges')
  list(@Query() q: PublicChallengesQuery, @CurrentUser() me?: Principal) {
    return this.challenges.list(q, me?.userId);
  }

  @OptionalAuth()
  @Get('challenges/:idOrSlug')
  detail(@Param('idOrSlug') idOrSlug: string, @CurrentUser() me?: Principal) {
    return this.challenges.detail(idOrSlug, me?.userId);
  }

  @Post('challenges/:id/join')
  join(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: JoinDto) {
    return this.challenges.join(me.userId, id, dto.petId);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('challenges/:id/check-in')
  checkIn(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckInDto) {
    return this.challenges.checkIn(me.userId, id, dto);
  }

  @OptionalAuth()
  @Get('challenges/:id/leaderboard')
  leaderboard(@Param('id', ParseUUIDPipe) id: string, @Query() q: BoardQuery, @CurrentUser() me?: Principal) {
    return this.challenges.leaderboard(id, q.limit, me?.userId);
  }

  @Get('users/me/badges')
  myBadges(@CurrentUser() me: Principal) {
    return this.challenges.userBadges(me.userId);
  }

  @OptionalAuth()
  @Get('users/:id/badges')
  badges(@Param('id', ParseUUIDPipe) id: string) {
    return this.challenges.userBadges(id);
  }
}

@ApiTags('Admin · Challenges')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin')
export class AdminChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  @Get('challenges')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  list(@Query() q: AdminChallengesQuery) {
    return this.challenges.adminList(q);
  }

  @Post('challenges')
  @RequirePermissions(PERMISSIONS.CHALLENGES_MANAGE)
  create(@CurrentUser() me: Principal, @Body() dto: ChallengeDto) {
    return this.challenges.create(me.userId, dto);
  }

  @Get('challenges/:id')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.challenges.adminDetail(id);
  }

  @Patch('challenges/:id')
  @RequirePermissions(PERMISSIONS.CHALLENGES_MANAGE)
  update(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChallengeDto) {
    return this.challenges.update(me.userId, id, dto);
  }

  @Post('challenges/:id/status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CHALLENGES_MANAGE)
  status(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChallengeStatusDto) {
    return this.challenges.setStatus(me.userId, id, dto.to);
  }

  @Get('challenges/:id/leaderboard')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  board(@Param('id', ParseUUIDPipe) id: string) {
    return this.challenges.leaderboard(id, 100);
  }

  @Get('badges')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  badges() {
    return this.challenges.badges();
  }

  @Post('badges')
  @RequirePermissions(PERMISSIONS.CHALLENGES_MANAGE)
  createBadge(@CurrentUser() me: Principal, @Body() dto: BadgeDto) {
    return this.challenges.saveBadge(me.userId, dto);
  }

  @Patch('badges/:id')
  @RequirePermissions(PERMISSIONS.CHALLENGES_MANAGE)
  updateBadge(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BadgeDto) {
    return this.challenges.saveBadge(me.userId, dto, id);
  }
}
