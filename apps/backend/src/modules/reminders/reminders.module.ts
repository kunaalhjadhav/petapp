import { Module } from '@nestjs/common';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { PromotionSender } from './promotion.sender';
import { ReminderSweeper } from './reminder-sweeper';

/** API side: staff write promotions. */
@Module({
  controllers: [PromotionsController],
  providers: [PromotionsService],
})
export class RemindersModule {}

/** Worker side: reminders, membership expiry and sending promotions. */
@Module({
  providers: [ReminderSweeper, PromotionSender],
  exports: [ReminderSweeper, PromotionSender],
})
export class RemindersCoreModule {}
