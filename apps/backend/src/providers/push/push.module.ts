import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { ConsolePushProvider, FcmPushProvider, NoopPushProvider, PUSH_PROVIDER, type PushProvider } from './push.provider';

@Global()
@Module({
  providers: [
    {
      provide: PUSH_PROVIDER,
      inject: [AppConfig],
      useFactory: (c: AppConfig): PushProvider => {
        const kind = c.get('PUSH_PROVIDER');
        if (kind === 'fcm') return new FcmPushProvider(c.get('FCM_PROJECT_ID')!, c.get('FCM_CLIENT_EMAIL')!, c.get('FCM_PRIVATE_KEY')!);
        return kind === 'console' ? new ConsolePushProvider() : new NoopPushProvider();
      },
    },
  ],
  exports: [PUSH_PROVIDER],
})
export class PushModule {}
