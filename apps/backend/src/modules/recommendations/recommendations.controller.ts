import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, OptionalAuth, RequestMeta, RequireFeature, RequirePermissions, type RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { decodeOffset } from '../posts/text';
import { HomeService } from './home.service';
import { RecoService } from './reco.service';
import {
  CreateHomeSectionDto, DismissDto, PersonalisationDto, PinDto, PreviewQuery, RecoQuery, ReelsQuery, ReorderSectionsDto, UpdateHomeSectionDto, WhereQuery,
} from './reco.dto';

@ApiTags('Home & recommendations')
@ApiBearerAuth()
@Controller()
export class RecommendationsController {
  constructor(
    private readonly reco: RecoService,
    private readonly home: HomeService,
  ) {}

  /** The home screen: the sections admins arranged, each filled for this person (or for everyone, signed out). */
  @OptionalAuth()
  @Get('home')
  async homeScreen(@Query() q: WhereQuery, @CurrentUser() me?: Principal) {
    return this.home.home(await this.reco.who(me?.userId, q));
  }

  /** Products for this person's pets and shopping history, with why each was picked. */
  @OptionalAuth()
  @RequireFeature('ENABLE_MARKETPLACE')
  @Get('recommendations/products')
  async products(@Query() q: RecoQuery, @CurrentUser() me?: Principal) {
    return this.reco.products(await this.reco.who(me?.userId, q), q.limit ?? 10);
  }

  /** Service partners near the given point (or their saved address), for their pets and booking history. */
  @OptionalAuth()
  @RequireFeature('ENABLE_SERVICES')
  @Get('recommendations/services')
  async services(@Query() q: RecoQuery, @CurrentUser() me?: Principal) {
    return this.reco.partners(await this.reco.who(me?.userId, q), q.limit ?? 10);
  }

  /** Contests open for entries that their pets can enter, then ones open for voting. */
  @OptionalAuth()
  @RequireFeature('ENABLE_CONTESTS')
  @Get('recommendations/contests')
  async contests(@Query() q: RecoQuery, @CurrentUser() me?: Principal) {
    return this.reco.contests(await this.reco.who(me?.userId, q), q.limit ?? 10);
  }

  /** The Reels tab, "For you": trending reels lifted by follows, their pets' species and what they like. */
  @OptionalAuth()
  @RequireFeature('ENABLE_REELS')
  @Get('recommendations/reels')
  async reels(@Query() q: ReelsQuery, @CurrentUser() me?: Principal) {
    return this.reco.reels(await this.reco.who(me?.userId), decodeOffset(q.cursor), q.limit ?? 10);
  }

  /** "Not interested": never recommend this item to me again. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('recommendations/dismiss')
  @HttpCode(204)
  async dismiss(@CurrentUser() me: Principal, @Body() dto: DismissDto) {
    await this.reco.dismiss(me.userId, dto.targetType, dto.targetId);
  }

  /** Whether recommendations are personalised for me, and what they're based on. */
  @Get('me/recommendations')
  settings(@CurrentUser() me: Principal) {
    return this.reco.settings(me.userId);
  }

  /** Turn personalisation on or off. Off also deletes what I've viewed. */
  @Put('me/recommendations')
  setPersonalised(@CurrentUser() me: Principal, @Body() dto: PersonalisationDto) {
    return this.reco.setPersonalised(me.userId, dto.personalised);
  }

  /** Forget what I've viewed and the items I marked "Not interested". */
  @Delete('me/recommendations/history')
  clearHistory(@CurrentUser() me: Principal) {
    return this.reco.clearHistory(me.userId);
  }
}

@ApiTags('Admin · Home screen')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/home-sections')
export class AdminHomeController {
  constructor(
    private readonly home: HomeService,
    private readonly reco: RecoService,
  ) {}

  @Get() @RequirePermissions(PERMISSIONS.SETTINGS_READ) list() {
    return this.home.list();
  }

  /** What someone signed out in this place sees right now, and which sections are left out and why. */
  @Get('preview') @RequirePermissions(PERMISSIONS.SETTINGS_READ) async preview(@Query() q: PreviewQuery) {
    const { sections, skipped } = await this.home.build(await this.reco.who(undefined, q));
    return { city: q.city ?? null, sections, skipped };
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.SETTINGS_READ) one(@Param('id', ParseUUIDPipe) id: string) {
    return this.home.one(id);
  }

  @Post() @RequirePermissions(PERMISSIONS.HOME_MANAGE) create(@CurrentUser() me: Principal, @Body() dto: CreateHomeSectionDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.home.create(me.userId, dto, meta);
  }

  /** Every section's id, in the new order. */
  @Put('order') @RequirePermissions(PERMISSIONS.HOME_MANAGE) reorder(@CurrentUser() me: Principal, @Body() dto: ReorderSectionsDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.home.reorder(me.userId, dto.ids, meta);
  }

  @Patch(':id') @RequirePermissions(PERMISSIONS.HOME_MANAGE) update(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHomeSectionDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.home.update(me.userId, id, dto, meta);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.HOME_MANAGE) async remove(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    await this.home.remove(me.userId, id, meta);
  }

  /** Pin an item to the start of a section: a link, @handle, slug, coupon code or id. */
  @Post(':id/pins') @RequirePermissions(PERMISSIONS.HOME_MANAGE) pin(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PinDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.home.addPin(me.userId, id, dto.ref, meta);
  }

  @Delete(':id/pins/:itemId') @RequirePermissions(PERMISSIONS.HOME_MANAGE) unpin(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.home.removePin(me.userId, id, itemId, meta);
  }
}
