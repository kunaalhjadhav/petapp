import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, Public, RequestMeta, RequirePermissions, type RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { WithMessage } from '../../common/dto/pagination.dto';
import type { Principal } from '../../common/principal';
import { LegalService } from './legal.service';
import { ConsentService } from './consent.service';
import { DataExportService } from './data-export.service';
import { PrivacyAdminService } from './privacy-admin.service';
import { AcceptDto, MarketingDto, NewDraftDto, PrivacyRequestsQuery, PublishLegalDto, UpdateLegalDto } from './privacy.dto';

@ApiTags('Legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  /** Published documents (privacy policy, terms…). No sign-in needed. */
  @Public() @Get() list() {
    return this.legal.list();
  }

  /** The current version of one document, in Markdown. */
  @Public() @Get(':slug') read(@Param('slug') slug: string) {
    return this.legal.read(slug);
  }
}

@ApiTags('Privacy')
@ApiBearerAuth()
@Controller('me')
export class MyPrivacyController {
  constructor(
    private readonly consents: ConsentService,
    private readonly exports: DataExportService,
  ) {}

  /** Documents accepted, documents still to accept, and the marketing choice. */
  @Get('consents') consentStatus(@CurrentUser() me: Principal) {
    return this.consents.status(me.userId);
  }

  /** Accept the current version of a document. */
  @Post('consents') @HttpCode(200) accept(@CurrentUser() me: Principal, @Body() dto: AcceptDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.consents.accept(me.userId, dto.slug, dto.version, meta);
  }

  /** Turn offers and news on or off. */
  @Put('marketing') marketing(@CurrentUser() me: Principal, @Body() dto: MarketingDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.consents.setMarketing(me.userId, dto.granted, meta);
  }

  /** Copies of my data I asked for, and whether I can ask for another. */
  @Get('data-exports') exportList(@CurrentUser() me: Principal) {
    return this.exports.list(me.userId);
  }

  /** Ask for a copy of my data. Ready within minutes; a notification says when. One a day. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('data-exports') async requestExport(@CurrentUser() me: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return new WithMessage(await this.exports.request(me.userId, meta), 'We’re preparing a copy of your data. We’ll notify you when it’s ready to download.');
  }

  /** A five-minute download link for a ready copy. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('data-exports/:id/link') link(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.exports.link(me.userId, id);
  }
}

@ApiTags('Admin · Legal')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/legal')
export class AdminLegalController {
  constructor(private readonly legal: LegalService) {}

  /** Every document: the current version with how many accepted it, and any draft. */
  @Get() @RequirePermissions(PERMISSIONS.SETTINGS_READ) list() {
    return this.legal.adminList();
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.SETTINGS_READ) one(@Param('id', ParseUUIDPipe) id: string) {
    return this.legal.adminOne(id);
  }

  /** Start a new version, copied from the latest. */
  @Post() @RequirePermissions(PERMISSIONS.LEGAL_MANAGE) draft(@CurrentUser() me: Principal, @Body() dto: NewDraftDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.legal.createDraft(dto.slug, me.userId, meta);
  }

  @Patch(':id') @RequirePermissions(PERMISSIONS.LEGAL_MANAGE) update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLegalDto) {
    return this.legal.updateDraft(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.LEGAL_MANAGE) async remove(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    await this.legal.deleteDraft(id, me.userId, meta);
  }

  /** Make a draft the current version. Refused while {{placeholders}} remain. */
  @Post(':id/publish') @HttpCode(200) @RequirePermissions(PERMISSIONS.LEGAL_MANAGE) publish(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishLegalDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.legal.publish(id, dto, me.userId, meta);
  }
}

@ApiTags('Admin · Privacy')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/privacy')
export class AdminPrivacyController {
  constructor(private readonly privacy: PrivacyAdminService) {}

  /** Account deletions: waiting for the grace period, held back (with why), or erased; plus data export numbers. */
  @Get('deletions') @RequirePermissions(PERMISSIONS.USERS_READ) deletions(@Query() q: PrivacyRequestsQuery) {
    return this.privacy.deletions(q);
  }

  /** Erase an account now instead of waiting for the grace period. Still held back while money or a service is in progress. */
  @Post('deletions/:userId/erase') @HttpCode(200) @RequirePermissions(PERMISSIONS.PRIVACY_MANAGE) erase(@CurrentUser() me: Principal, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.privacy.eraseNow(userId, me.userId);
  }

  /** Cancel a deletion the person asked for (when they ask support to). */
  @Post('deletions/:userId/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.PRIVACY_MANAGE) cancel(@CurrentUser() me: Principal, @Param('userId', ParseUUIDPipe) userId: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.privacy.cancel(userId, me.userId, meta);
  }
}
