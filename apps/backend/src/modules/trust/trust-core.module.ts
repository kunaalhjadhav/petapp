import { Module } from '@nestjs/common';
import { AiProviderModule } from '../../providers/ai/ai-provider.module';
import { SafetyService } from '../safety/safety.service';
import { AiModerationService } from './ai-moderation.service';
import { RiskService } from './risk.service';

/** Trust & safety services shared by the API and the worker (AI moderation checks, account risk). */
@Module({
  imports: [AiProviderModule],
  providers: [SafetyService, AiModerationService, RiskService],
  exports: [AiModerationService, RiskService],
})
export class TrustCoreModule {}
