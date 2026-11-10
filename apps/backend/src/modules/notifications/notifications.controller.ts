import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { CursorQuery } from '../posts/dto/posts.dto';
import { NotificationsService } from './notifications.service';
import { MarkReadDto, PreferencesDto, RegisterDeviceDto } from './notifications.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() me: Principal, @Query() q: CursorQuery) {
    return this.svc.list(me.userId, q.cursor, q.limit);
  }

  @Get('notifications/unread-count')
  async unread(@CurrentUser() me: Principal) {
    return { unread: await this.svc.unread(me.userId) };
  }

  @Post('notifications/read')
  @HttpCode(200)
  read(@CurrentUser() me: Principal, @Body() dto: MarkReadDto) {
    return this.svc.markRead(me.userId, dto.ids);
  }

  @Get('notifications/preferences')
  prefs(@CurrentUser() me: Principal) {
    return this.svc.preferences(me.userId);
  }

  @Put('notifications/preferences')
  setPrefs(@CurrentUser() me: Principal, @Body() dto: PreferencesDto) {
    return this.svc.setPreferences(me.userId, dto);
  }

  /** Call after sign-in and whenever FCM rotates the token. */
  @Post('devices')
  @HttpCode(200)
  register(@CurrentUser() me: Principal, @Body() dto: RegisterDeviceDto) {
    return this.svc.registerDevice(me.userId, dto);
  }

  /** Call before signing out so the device stops receiving this account's pushes. */
  @Delete('devices/:token')
  remove(@CurrentUser() me: Principal, @Param('token') token: string) {
    return this.svc.removeDevice(me.userId, token);
  }
}
