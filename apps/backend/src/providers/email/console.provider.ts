import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider } from './email.provider';

/** Development only: prints the email in the API log (refused in staging and production). */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  readonly canSend = true;
  private readonly logger = new Logger('Email');
  async send(m: EmailMessage) {
    this.logger.warn(`DEV EMAIL → ${m.to}] ${m.subject}\n${m.text}`);
    return {};
  }
}
