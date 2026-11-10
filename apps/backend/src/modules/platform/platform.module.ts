import { Global, Module } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { AdminPlatformController, PublicConfigController } from './platform.controller';
import { FeatureGuard } from './feature.guard';
import { OverviewController } from './overview.controller';

@Global()
@Module({
  providers: [PlatformService, FeatureGuard],
  controllers: [PublicConfigController, AdminPlatformController, OverviewController],
  exports: [PlatformService, FeatureGuard],
})
export class PlatformModule {}
