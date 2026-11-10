import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, Public, RequestMeta, RequirePermissions, type RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { WithMessage } from '../../common/dto/pagination.dto';
import type { Principal } from '../../common/principal';
import { ChatRealtime } from './chat.realtime';
import { ChatService } from './chat.service';
import { CHAT_WS_PATH } from './chat.gateway';
import { SupportService } from './support.service';
import {
  AdminTicketsQuery, AppQuery, CategoryDto, CreateTicketDto, FaqDto, FaqFeedbackDto, FaqQuery, ListConversationsQuery, MessagesQuery, OptionalAppQuery, SendMessageDto,
  StaffReplyDto, StaffStartTicketDto, StartConversationDto, UpdateCategoryDto, UpdateFaqDto, UpdateTicketDto,
} from './chat.dto';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly realtime: ChatRealtime,
  ) {}

  /** A one-time ticket (valid for a minute) to open the live connection: `wss://<api>/api/v1/chat/ws?ticket=…`. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('realtime-ticket') @HttpCode(200) async ticket(@CurrentUser() me: Principal) {
    return { ticket: await this.realtime.issueTicket(me.userId), path: CHAT_WS_PATH, expiresInSeconds: 60 };
  }

  /** Unread counts for each app's badge, including support replies. */
  @Get('unread') unread(@CurrentUser() me: Principal) {
    return this.chat.unread(me.userId);
  }

  /** Conversations in one app's inbox, newest first. */
  @Get('conversations') list(@CurrentUser() me: Principal, @Query() q: ListConversationsQuery) {
    return this.chat.list(me.userId, q);
  }

  /** Open the conversation with a partner, about a product, a booking or an order (created the first time). */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('conversations') @HttpCode(200) start(@CurrentUser() me: Principal, @Body() dto: StartConversationDto) {
    return this.chat.start(me.userId, dto);
  }

  @Get('conversations/:id') get(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.get(me.userId, id);
  }

  @Get('conversations/:id/messages') messages(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Query() q: MessagesQuery) {
    return this.chat.messages(me.userId, id, q);
  }

  /** Send text, a photo, or a booking, product or order card. Repeat with the same `clientId` safely. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('conversations/:id/messages') send(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(me.userId, id, dto);
  }

  @Post('conversations/:id/read') @HttpCode(200) read(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.markRead(me.userId, id);
  }

  /** Block the other side: neither can send any more, and they're hidden from each other elsewhere too. */
  @Post('conversations/:id/block') @HttpCode(200) block(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.block(me.userId, id, true);
  }

  @Post('conversations/:id/unblock') @HttpCode(200) unblock(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.block(me.userId, id, false);
  }
}

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** Help center: published questions and topics for one app. No sign-in needed. */
  @Public() @Get('faqs') faqs(@Query() q: FaqQuery) {
    return this.support.faqs(q);
  }

  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('faqs/:id/feedback') @HttpCode(200) feedback(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FaqFeedbackDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.support.feedback(id, dto.helpful, meta.ip);
  }

  @Public() @Get('categories') categories(@Query() q: AppQuery) {
    return this.support.categories(q.app);
  }

  /** Ask for help. Replies arrive in the ticket's conversation (`conversationId`), using the chat endpoints. */
  @ApiBearerAuth() @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('tickets') async create(@CurrentUser() me: Principal, @Body() dto: CreateTicketDto) {
    const t = await this.support.create(me.userId, dto);
    return new WithMessage(t, `Thanks. Your ticket is ${t.code}; we’ll reply here.`);
  }

  @ApiBearerAuth() @Get('tickets') mine(@CurrentUser() me: Principal, @Query() q: OptionalAppQuery) {
    return this.support.myTickets(me.userId, q.app);
  }

  @ApiBearerAuth() @Get('tickets/:id') one(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.mine(me.userId, id);
  }

  @ApiBearerAuth() @Post('tickets/:id/close') @HttpCode(200) close(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.closeMine(me.userId, id);
  }
}

@ApiTags('Admin · Support')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  /** Counts for the queue's tabs and the menu badge. */
  @Get('summary') @RequirePermissions(PERMISSIONS.SUPPORT_READ) summary(@CurrentUser() me: Principal) {
    return this.support.summary(me);
  }

  @Get('tickets') @RequirePermissions(PERMISSIONS.SUPPORT_READ) list(@CurrentUser() me: Principal, @Query() q: AdminTicketsQuery) {
    return this.support.adminList(me, q);
  }

  /** Start a conversation with someone (Admin ↔ user), as a ticket they can answer in the app. */
  @Post('tickets') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE) start(@CurrentUser() me: Principal, @Body() dto: StaffStartTicketDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.support.staffStart(me, dto, meta);
  }

  @Get('tickets/:id') @RequirePermissions(PERMISSIONS.SUPPORT_READ) detail(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.adminDetail(me, id);
  }

  /** The thread, including staff notes. */
  @Get('tickets/:id/messages') @RequirePermissions(PERMISSIONS.SUPPORT_READ) messages(@Param('id', ParseUUIDPipe) id: string, @Query() q: MessagesQuery) {
    return this.support.adminMessages(id, q);
  }

  @Post('tickets/:id/messages') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE) reply(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffReplyDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.support.reply(me, id, dto, meta);
  }

  /** Status, priority, category and who handles it. */
  @Patch('tickets/:id') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE) update(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.support.update(me, id, dto, meta);
  }

  @Get('assignees') @RequirePermissions(PERMISSIONS.SUPPORT_READ) assignees() {
    return this.support.assignees();
  }

  @Get('faqs') @RequirePermissions(PERMISSIONS.SUPPORT_READ) faqs() {
    return this.support.adminFaqs();
  }

  @Post('faqs') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE) createFaq(@CurrentUser() me: Principal, @Body() dto: FaqDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.support.createFaq(me, dto, meta);
  }

  @Patch('faqs/:id') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE) updateFaq(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFaqDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.support.updateFaq(me, id, dto, meta);
  }

  @Post('faqs/:id/delete') @HttpCode(200) @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE) deleteFaq(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.support.deleteFaq(me, id, meta);
  }

  @Get('categories') @RequirePermissions(PERMISSIONS.SUPPORT_READ) categories() {
    return this.support.adminCategories();
  }

  @Post('categories') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE) createCategory(@CurrentUser() me: Principal, @Body() dto: CategoryDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.support.createCategory(me, dto, meta);
  }

  @Patch('categories/:id') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE) updateCategory(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.support.updateCategory(me, id, dto, meta);
  }
}
