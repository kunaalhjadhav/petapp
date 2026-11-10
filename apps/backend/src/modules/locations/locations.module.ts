import { Global, Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { AdminLocationsController, LocationsController } from './locations.controller';

/** Global: the shop (delivery zones) and search use it. */
@Global()
@Module({
  controllers: [LocationsController, AdminLocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
