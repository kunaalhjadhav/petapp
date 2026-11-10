import { Global, Logger, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { AI_PROVIDER, ClaudeAiProvider, RulesAiProvider, type AiProvider } from './ai.provider';

/** AI moderation: Claude when AI_PROVIDER=anthropic (with a key), otherwise the built-in rules. */
@Global()
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [AppConfig],
      useFactory: (c: AppConfig): AiProvider => {
        if (c.get('AI_PROVIDER') === 'anthropic') {
          return new ClaudeAiProvider(c.get('ANTHROPIC_API_KEY')!, c.get('AI_MODERATION_MODEL'), c.get('AI_TIMEOUT_MS'), c.get('ANTHROPIC_BASE_URL'));
        }
        new Logger('AiProvider').log('AI moderation uses the built-in rules (AI_PROVIDER=rules)');
        return new RulesAiProvider();
      },
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiProviderModule {}
