import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ReviewsService } from './reviews.service';
import { AdminReviewsController, BusinessReviewsController, ReviewsController } from './reviews.controller';

@Module({
  imports: [MediaModule],
  controllers: [ReviewsController, BusinessReviewsController, AdminReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
