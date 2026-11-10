import { Logger, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ContestsModule } from '../contests/contests.module';
import { ServicesModule } from '../services/services.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { ASSISTANT_PROVIDER, ClaudeAssistantProvider, type AssistantProvider } from '../../providers/ai/assistant.provider';
import { AssistantService } from './assistant.service';
import { AssistantTools } from './assistant.tools';
import { AdminAssistantController, AssistantController } from './assistant.controller';
import { RulesAssistant } from './rules-assistant';

/** PetApp Assistant: Claude when AI_PROVIDER=anthropic (with a key), otherwise the built-in assistant. */
@Module({
  imports: [MarketplaceModule, ContestsModule, ServicesModule, RecommendationsModule],
  controllers: [AssistantController, AdminAssistantController],
  providers: [
    AssistantService,
    AssistantTools,
    {
      provide: ASSISTANT_PROVIDER,
      inject: [AppConfig],
      useFactory: (c: AppConfig): AssistantProvider => {
        if (c.get('AI_PROVIDER') === 'anthropic') {
          return new ClaudeAssistantProvider(c.get('ANTHROPIC_API_KEY')!, c.get('AI_ASSISTANT_MODEL'), c.get('AI_ASSISTANT_TIMEOUT_MS'), c.get('ANTHROPIC_BASE_URL'));
        }
        new Logger('AssistantProvider').log('PetApp Assistant uses the built-in answers (AI_PROVIDER=rules)');
        return new RulesAssistant();
      },
    },
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
