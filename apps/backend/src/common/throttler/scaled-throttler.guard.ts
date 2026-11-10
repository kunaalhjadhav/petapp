import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';

/**
 * The normal rate limits, multiplied by RATE_LIMIT_MULTIPLIER for load tests on staging or locally (a load generator
 * sends everything from one address). The setting is refused in production, so real limits always apply there.
 */
@Injectable()
export class ScaledThrottlerGuard extends ThrottlerGuard {
  static multiplier = Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER ?? 1) || 1);

  protected override handleRequest(req: ThrottlerRequest): Promise<boolean> {
    return super.handleRequest(ScaledThrottlerGuard.multiplier === 1 ? req : { ...req, limit: req.limit * ScaledThrottlerGuard.multiplier });
  }
}
