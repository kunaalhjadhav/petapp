import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { SafetyModule } from '../safety/safety.module';
import { MetricsModule } from '../../observability/observability.module';
import { AdminSupportController, ChatController, SupportController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatRealtime } from './chat.realtime';
import { ChatService } from './chat.service';
import { SupportService } from './support.service';

/** Phase 9a: chat (spec §37) and the support center (spec §58). */
@Module({
  imports: [MediaModule, SafetyModule, MetricsModule],
  controllers: [ChatController, SupportController, AdminSupportController],
  providers: [ChatRealtime, ChatService, SupportService, ChatGateway],
  exports: [ChatGateway, SupportService],
})
export class ChatModule {}
