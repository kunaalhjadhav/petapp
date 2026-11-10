import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { AssistantService } from './assistant.service';
import { AskDto, FeedbackQuery, RateDto } from './assistant.dto';

@ApiTags('PetApp Assistant')
@ApiBearerAuth()
@RequireFeature('ENABLE_AI_ASSISTANT')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** What to show before the first question: intro, health notice, privacy, suggestions and today's allowance. */
  @Get() info(@CurrentUser() me: Principal) {
    return this.assistant.info(me.userId);
  }

  /** Ask a question. Starts a conversation unless `conversationId` is given. */
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('messages') @HttpCode(200) ask(@CurrentUser() me: Principal, @Body() dto: AskDto) {
    return this.assistant.ask(me.userId, dto);
  }

  /** Thumbs up or down on an answer. */
  @Post('messages/:id/rating') @HttpCode(200) rate(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RateDto) {
    return this.assistant.rate(me.userId, id, dto.rating, dto.note);
  }

  @Get('conversations') list(@CurrentUser() me: Principal, @Query() q: PaginationQuery) {
    return this.assistant.conversations(me.userId, q);
  }

  @Get('conversations/:id') one(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.assistant.conversation(me.userId, id);
  }

  @Delete('conversations/:id') @HttpCode(204) async remove(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.assistant.remove(me.userId, id);
  }

  /** Delete all my conversations. */
  @Delete('conversations') removeAll(@CurrentUser() me: Principal) {
    return this.assistant.removeAll(me.userId);
  }
}

@ApiTags('Admin · PetApp Assistant')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/assistant')
export class AdminAssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Provider, switch, limits and the last day's numbers (answers, emergencies, health answers, failures, tokens). */
  @Get('status') @RequirePermissions(PERMISSIONS.SETTINGS_READ) status() {
    return this.assistant.status();
  }

  /** Answers people rated, with the question. Conversations nobody rated stay private. */
  @Get('feedback') @RequirePermissions(PERMISSIONS.CONTENT_READ) feedback(@Query() q: FeedbackQuery) {
    return this.assistant.feedback(q);
  }
}
