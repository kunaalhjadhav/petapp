import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { UsersModule } from '../users/users.module';
import { SafetyService } from './safety.service';
import { ModerationService } from './moderation.service';
import { ModerationController, ReportsController, SafetyController } from './safety.controller';

@Module({
  imports: [MediaModule, UsersModule],
  controllers: [SafetyController, ModerationController, ReportsController],
  providers: [SafetyService, ModerationService],
  exports: [SafetyService],
})
export class SafetyModule {}
