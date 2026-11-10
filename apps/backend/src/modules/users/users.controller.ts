import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@petapp/types';
import {
  AdminOnly, CurrentUser, OptionalAuth, RequestMeta, RequirePermissions, type RequestMetaInfo,
} from '../../common/decorators/auth.decorators';
import { WithMessage } from '../../common/dto/pagination.dto';
import type { Principal } from '../../common/principal';
import { UsersService } from './users.service';
import { AddressDto, AdminUsersQuery, SetRolesDto, SetStatusDto, UpdateAddressDto, UpdateMeDto } from './dto/users.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() me: Principal) {
    return this.users.me(me.userId);
  }

  @Patch('me')
  update(@CurrentUser() me: Principal, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(me.userId, dto);
  }

  @Delete('me')
  @HttpCode(200)
  async remove(@CurrentUser() me: Principal, @RequestMeta() meta: RequestMetaInfo) {
    const r = await this.users.requestDeletion(me.userId, meta);
    return new WithMessage(r, `Your account will be deleted in ${r.graceDays} days and you have been signed out. Sign in again before then to keep it.`);
  }

  @Get('me/addresses')
  addresses(@CurrentUser() me: Principal) {
    return this.users.addresses(me.userId);
  }

  @Post('me/addresses')
  addAddress(@CurrentUser() me: Principal, @Body() dto: AddressDto) {
    return this.users.addAddress(me.userId, dto);
  }

  @Patch('me/addresses/:id')
  updateAddress(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAddressDto) {
    return this.users.updateAddress(me.userId, id, dto);
  }

  @Delete('me/addresses/:id')
  async deleteAddress(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.deleteAddress(me.userId, id);
    return null;
  }

  @OptionalAuth()
  @Get(':id')
  profile(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me?: Principal) {
    return this.users.publicProfile(id, me?.userId);
  }

  @Post(':id/follow')
  @HttpCode(200)
  follow(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.follow(me.userId, id);
  }

  @Delete(':id/follow')
  unfollow(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.unfollow(me.userId, id);
  }
}

@ApiTags('Admin · Users')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  list(@Query() q: AdminUsersQuery) {
    return this.users.adminList(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.adminDetail(id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_SUSPEND)
  setStatus(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStatusDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.adminSetStatus(me, id, dto, meta);
  }

  @Put(':id/roles')
  @RequirePermissions(PERMISSIONS.USERS_ROLES_ASSIGN)
  setRoles(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolesDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.adminSetRoles(me, id, dto, meta);
  }
}
