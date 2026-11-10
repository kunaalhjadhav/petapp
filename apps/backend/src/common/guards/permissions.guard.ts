import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/auth.decorators';
import type { Principal } from '../principal';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const principal: Principal | undefined = ctx.switchToHttp().getRequest().principal;
    if (!principal) throw new ForbiddenException('You do not have permission to do this.');
    if (principal.isSuperAdmin) return true;
    const granted = new Set(principal.permissions);
    if (!required.every((p) => granted.has(p))) throw new ForbiddenException('You do not have permission to do this.');
    return true;
  }
}
