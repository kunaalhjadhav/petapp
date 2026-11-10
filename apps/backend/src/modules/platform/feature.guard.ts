import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureFlagKey } from '@petapp/types';
import { FEATURE_KEY } from '../../common/decorators/auth.decorators';
import { PlatformService } from './platform.service';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly platform: PlatformService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<FeatureFlagKey>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!flag) return true;
    if (!(await this.platform.isEnabled(flag))) throw new NotFoundException('This feature is not available right now.');
    return true;
  }
}
