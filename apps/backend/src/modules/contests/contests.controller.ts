import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import {
  AdminOnly, CurrentUser, OptionalAuth, Public, RequestMeta, RequireFeature, RequirePermissions, type RequestMetaInfo,
} from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { ContestsService } from './contests.service';
import { InterestService } from '../recommendations/interest.service';
import {
  AdminContestsQuery, CategoryDto, ContestDto, LegalApprovalDto, ParticipantStatusDto, PublicContestsQuery, RegisterDto, ScoresDto,
  SpecialAwardDto, SubmissionDto, TransitionDto, UpdateContestDto, VoteReviewDto,
} from './contests.dto';

@ApiTags('Contests')
@ApiBearerAuth()
@RequireFeature('ENABLE_CONTESTS')
@Controller()
export class ContestsController {
  constructor(
    private readonly contests: ContestsService,
    private readonly interest: InterestService,
  ) {}

  @Public()
  @Get('contest-categories')
  categories() {
    return this.contests.categories();
  }

  @Public()
  @Get('contests')
  list(@Query() q: PublicContestsQuery) {
    return this.contests.list(q);
  }

  @OptionalAuth()
  @Get('contests/:idOrSlug')
  async detail(@Param('idOrSlug') idOrSlug: string, @CurrentUser() me?: Principal) {
    const c = await this.contests.detail(idOrSlug, me?.userId);
    this.interest.record(me?.userId, 'CONTEST_VIEW', c.id, c.category?.id);
    return c;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('contests/:id/register')
  register(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RegisterDto) {
    return this.contests.register(me.userId, id, dto.petId);
  }

  @Public()
  @Get('contests/:id/leaderboard')
  leaderboard(@Param('id', ParseUUIDPipe) id: string) {
    return this.contests.leaderboard(id);
  }

  @Public()
  @Get('contest-entries/:id')
  entry(@Param('id', ParseUUIDPipe) id: string) {
    return this.contests.entry(id);
  }

  @Post('contest-entries/:id/submissions')
  submit(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmissionDto) {
    return this.contests.submit(me.userId, id, dto);
  }

  /** Needs the "Public voting" switch as well as "Contests". */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('contest-entries/:id/vote')
  @HttpCode(200)
  vote(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.contests.vote(me.userId, id, meta.ip);
  }

  // ── judges (app accounts with the Judge role, assigned to the contest) ──

  @Get('judge/contests')
  judgeContests(@CurrentUser() me: Principal) {
    return this.contests.judgeContests(me.userId);
  }

  @Get('judge/contests/:id/entries')
  judgeEntries(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.contests.judgeEntries(me.userId, id);
  }

  @Put('judge/contest-entries/:id/scores')
  score(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScoresDto) {
    return this.contests.score(me.userId, id, dto.scores);
  }
}

@ApiTags('Admin · Contests')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin')
export class AdminContestsController {
  constructor(private readonly contests: ContestsService) {}

  @Get('contest-categories')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  categories() {
    return this.contests.categories(true);
  }

  @Post('contest-categories')
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  createCategory(@CurrentUser() me: Principal, @Body() dto: CategoryDto) {
    return this.contests.saveCategory(me.userId, dto);
  }

  @Patch('contest-categories/:id')
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  updateCategory(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryDto) {
    return this.contests.saveCategory(me.userId, dto, id);
  }

  @Get('contests')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  list(@Query() q: AdminContestsQuery) {
    return this.contests.adminList(q);
  }

  @Post('contests')
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  create(@CurrentUser() me: Principal, @Body() dto: ContestDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.contests.create(me.userId, dto, meta);
  }

  @Get('contests/:id')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.contests.adminDetail(id);
  }

  @Patch('contests/:id')
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  update(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContestDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.contests.update(me.userId, id, dto, meta);
  }

  @Post('contests/:id/transition')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  transition(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.contests.transition(me.userId, id, dto.to, dto.reason, meta);
  }

  /** Paid contests can't go live without this. Super admins only by default. */
  @Post('contests/:id/legal-approval')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTESTS_LEGAL_APPROVE)
  legal(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LegalApprovalDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.contests.legalApprove(me.userId, id, dto.note, meta);
  }

  /** "What if N people enter?" — the money split at any size. */
  @Get('contests/:id/finance/:participants')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  finance(@Param('id', ParseUUIDPipe) id: string, @Param('participants', ParseIntPipe) n: number) {
    return this.contests.financePreview(id, n);
  }

  @Get('contests/:id/leaderboard')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  leaderboard(@Param('id', ParseUUIDPipe) id: string) {
    return this.contests.leaderboard(id);
  }

  @Get('contests/:id/flagged-votes')
  @RequirePermissions(PERMISSIONS.CONTESTS_READ)
  flagged(@Param('id', ParseUUIDPipe) id: string) {
    return this.contests.flaggedVotes(id);
  }

  @Post('contest-votes/:id/review')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  reviewVote(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoteReviewDto) {
    return this.contests.reviewVote(me.userId, id, dto.valid);
  }

  @Patch('contest-entries/:id/status')
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  entryStatus(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ParticipantStatusDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.contests.setParticipantStatus(me.userId, id, dto, meta);
  }

  @Post('contests/:id/freeze')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  freeze(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.contests.freeze(me.userId, id, meta);
  }

  @Post('contests/:id/winners')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  winners(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.contests.declareWinners(me.userId, id, meta);
  }

  @Post('contest-prizes/:id/award')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTESTS_MANAGE)
  award(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SpecialAwardDto) {
    return this.contests.awardSpecial(me.userId, id, dto.participantId);
  }
}
