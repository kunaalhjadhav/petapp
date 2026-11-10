import { Module } from '@nestjs/common';
import {
  AdminServicesController,
  PartnerController,
  ServicesController,
} from './services.controller';
import { BookingsService } from './bookings.service';
import { PartnersService } from './partners.service';
import { ReviewsModule } from '../reviews/reviews.module';

@Module({
  imports: [ReviewsModule],
  controllers: [ServicesController, PartnerController, AdminServicesController],
  providers: [PartnersService, BookingsService],
  exports: [BookingsService],
})
export class ServicesModule {}
