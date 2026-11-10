import { Logger } from '@nestjs/common';
import { maskPhone } from '../../common/utils/phone';
import type { SmsMessage, SmsProvider } from './sms.provider';

/** Development only (refused in staging/production by env validation). Prints SMS to the log. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  private readonly logger = new Logger('SMS');

  async send(message: SmsMessage) {
    this.logger.warn(`[DEV SMS → ${maskPhone(message.to)}] ${message.body}`);
    return {};
  }
}
