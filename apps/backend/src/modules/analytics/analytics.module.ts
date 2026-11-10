import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/** Global: the auth guard records daily activity, and posts record reel views, through ActivityService. */
@Global()
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ActivityService],
  exports: [ActivityService],
})
export class AnalyticsModule {}
