import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, RequestMeta, RequirePermissions, type RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from './rbac.service';

class CreateRoleDto {
  @ApiProperty({ example: 'CONTENT_REVIEWER' }) @Matches(/^[A-Z][A-Z0-9_]{2,40}$/) key: string;
  @ApiProperty() @IsString() @Length(2, 60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) description?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isStaff?: boolean;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @IsString({ each: true }) permissionKeys: string[];
}
class UpdateRoleDto extends PartialType(CreateRoleDto) {}

@ApiTags('Admin · Roles')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] });
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  async roles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { permissions: { select: { permission: { select: { key: true } } } }, _count: { select: { users: true } } },
    });
    return roles.map(({ permissions, _count, ...r }) => ({ ...r, permissionKeys: permissions.map((p) => p.permission.key), userCount: _count.users }));
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  async create(@Body() dto: CreateRoleDto, @CurrentUser() me: Principal, @RequestMeta() meta: RequestMetaInfo) {
    const permIds = await this.permissionIds(dto.permissionKeys);
    const role = await this.prisma.$transaction(async (tx) => {
      const r = await tx.role.create({
        data: { key: dto.key, name: dto.name, description: dto.description, isStaff: dto.isStaff ?? false, permissions: { create: permIds.map((permissionId) => ({ permissionId })) } },
      });
      await this.audit.log({ actorId: me.userId, action: 'role.create', entityType: 'Role', entityId: r.key, after: dto, meta }, tx);
      return r;
    });
    return role;
  }

  @Patch('roles/:key')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  async update(@Param('key') key: string, @Body() dto: UpdateRoleDto, @CurrentUser() me: Principal, @RequestMeta() meta: RequestMetaInfo) {
    const role = await this.prisma.role.findUnique({ where: { key }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.key === 'SUPER_ADMIN') throw new BadRequestException('The SUPER_ADMIN role cannot be edited.');
    if (dto.key && dto.key !== role.key) throw new BadRequestException('Role keys cannot be changed.');
    const permIds = dto.permissionKeys ? await this.permissionIds(dto.permissionKeys) : undefined;
    const before = { name: role.name, isStaff: role.isStaff, permissionKeys: role.permissions.map((p) => p.permission.key) };

    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.role.update({ where: { id: role.id }, data: { name: dto.name, description: dto.description, isStaff: dto.isStaff } });
      if (permIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({ data: permIds.map((permissionId) => ({ roleId: role.id, permissionId })) });
      }
      await this.audit.log({ actorId: me.userId, action: 'role.update', entityType: 'Role', entityId: key, before, after: dto, meta }, tx);
      return r;
    });
    await this.rbac.invalidateAll();
    return updated;
  }

  @Delete('roles/:key')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  async remove(@Param('key') key: string, @CurrentUser() me: Principal, @RequestMeta() meta: RequestMetaInfo) {
    const role = await this.prisma.role.findUnique({ where: { key }, include: { _count: { select: { users: true } } } });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted.');
    if (role._count.users > 0) throw new BadRequestException('Remove this role from all users before deleting it.');
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id: role.id } });
      await this.audit.log({ actorId: me.userId, action: 'role.delete', entityType: 'Role', entityId: key, before: { name: role.name }, meta }, tx);
    });
    await this.rbac.invalidateAll();
    return null;
  }

  private async permissionIds(keys: string[]): Promise<string[]> {
    const perms = await this.prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
    const unknown = keys.filter((k) => !perms.some((p) => p.key === k));
    if (unknown.length) throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
    return perms.map((p) => p.id);
  }
}
