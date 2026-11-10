import { Module } from '@nestjs/common';
import { AdminMarketplaceController, ShopController, VendorController } from './marketplace.controller';
import { OrdersService } from './orders.service';
import { VendorsService } from './vendors.service';
import { MediaModule } from '../media/media.module';
import { ReviewsModule } from '../reviews/reviews.module';

@Module({ imports: [MediaModule, ReviewsModule], controllers: [ShopController, VendorController, AdminMarketplaceController], providers: [OrdersService, VendorsService], exports: [OrdersService] })
export class MarketplaceModule {}
