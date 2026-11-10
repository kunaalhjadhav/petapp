import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { EMAIL_PROVIDER, NoEmailProvider, type EmailProvider } from './email.provider';
import { ConsoleEmailProvider } from './console.provider';
import { SmtpEmailProvider } from './smtp.provider';

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [AppConfig],
      useFactory: (c: AppConfig): EmailProvider => {
        const kind = c.get('EMAIL_PROVIDER');
        if (kind === 'smtp') {
          return new SmtpEmailProvider(
            { host: c.get('SMTP_HOST')!, port: c.get('SMTP_PORT'), secure: c.get('SMTP_SECURE'), user: c.get('SMTP_USER')!, pass: c.get('SMTP_PASS')! },
            c.get('EMAIL_FROM'),
          );
        }
        return kind === 'console' ? new ConsoleEmailProvider() : new NoEmailProvider();
      },
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
