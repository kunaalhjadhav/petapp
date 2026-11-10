import { Controller, ForbiddenException, Get, Global, Headers, Module, NotFoundException, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { Public } from '../common/decorators/auth.decorators';
import { AppConfig } from '../config/app-config.service';
import { ERROR_TRACKER, trackerFromEnv } from './error-tracker';
import { MetricsService } from './metrics';
import { SystemController } from './system.controller';

/** Error reporting, shared by the API and the worker. */
@Global()
@Module({ providers: [{ provide: ERROR_TRACKER, useFactory: () => trackerFromEnv(process.env, process.env.PETAPP_SERVICE ?? 'api') }], exports: [ERROR_TRACKER] })
export class ErrorTrackingModule {}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Prometheus scrape endpoint. Needs `Authorization: Bearer $METRICS_TOKEN`; without a token it's off in staging/production. */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfig,
  ) {}

  @Get('metrics')
  async scrape(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    const token = this.config.get('METRICS_TOKEN');
    const live = ['production', 'staging'].includes(this.config.get('NODE_ENV'));
    if (!token && live) throw new NotFoundException();
    if (token && !same(auth ?? '', `Bearer ${token}`)) throw new ForbiddenException('A metrics token is required.');
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}

@Module({ providers: [MetricsService], controllers: [MetricsController, SystemController], exports: [MetricsService] })
export class MetricsModule {}
