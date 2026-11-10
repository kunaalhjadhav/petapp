import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDefined } from 'class-validator';
import { PERMISSIONS } from '@petapp/types';
import {
  AdminOnly, CurrentUser, Public, RequestMeta, RequirePermissions, type RequestMetaInfo,
} from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { PlatformService } from './platform.service';
import type { Prisma } from '../../generated/prisma/client';

class SetFlagDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
}
class SetSettingDto {
  @ApiProperty({ description: 'JSON value; type must match the setting' }) @IsDefined() value: Prisma.InputJsonValue;
}

@ApiTags('Config')
@Controller('config')
export class PublicConfigController {
  constructor(private readonly platform: PlatformService) {}

  @Public()
  @Get('flags')
  flags() {
    return this.platform.flags();
  }
}

@ApiTags('Admin · Platform')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin')
export class AdminPlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('flags')
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  listFlags() {
    return this.platform.listFlags();
  }

  @Patch('flags/:key')
  @RequirePermissions(PERMISSIONS.FLAGS_MANAGE)
  setFlag(@Param('key') key: string, @Body() dto: SetFlagDto, @CurrentUser() me: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.platform.setFlag(key, dto.enabled, me.userId, meta);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  listSettings() {
    return this.platform.listSettings();
  }

  @Put('settings/:key')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  setSetting(@Param('key') key: string, @Body() dto: SetSettingDto, @CurrentUser() me: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.platform.setSetting(key, dto.value, me.userId, meta);
  }
}
