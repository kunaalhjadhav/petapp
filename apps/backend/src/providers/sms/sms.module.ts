import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { SMS_PROVIDER, type SmsProvider } from './sms.provider';
import { ConsoleSmsProvider } from './console.provider';
import { SmsLocalProvider } from './smslocal.provider';

@Global()
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [AppConfig],
      useFactory: (c: AppConfig): SmsProvider => {
        if (c.get('SMS_PROVIDER') === 'smslocal') {
          return new SmsLocalProvider({
            apiUrl: c.get('SMSLOCAL_API_URL')!,
            apiKey: c.get('SMSLOCAL_API_KEY')!,
            senderId: c.get('SMSLOCAL_SENDER_ID')!,
            dltTemplateId: c.get('SMSLOCAL_DLT_TEMPLATE_ID'),
            dltEntityId: c.get('SMSLOCAL_DLT_ENTITY_ID'),
          });
        }
        return new ConsoleSmsProvider();
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
