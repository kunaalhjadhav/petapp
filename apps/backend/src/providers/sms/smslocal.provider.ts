import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { SmsMessage, SmsProvider } from './sms.provider';

export interface SmsLocalConfig {
  apiUrl: string;
  apiKey: string;
  senderId: string;
  dltTemplateId?: string;
  dltEntityId?: string;
}

/**
 * SMSLocal HTTP provider.
 * Request body follows SMSLocal's published JSON shape (api_key, sender, message, recipient).
 * India DLT: set SMSLOCAL_DLT_TEMPLATE_ID / SMSLOCAL_DLT_ENTITY_ID once your template is approved,
 * and make OTP_MESSAGE_TEMPLATE match the approved text exactly.
 * Confirm the endpoint URL and field names in your SMSLocal dashboard's API docs.
 */
export class SmsLocalProvider implements SmsProvider {
  readonly name = 'smslocal';
  private readonly logger = new Logger('SmsLocal');

  constructor(private readonly cfg: SmsLocalConfig) {}

  async send(message: SmsMessage) {
    const body: Record<string, string> = {
      api_key: this.cfg.apiKey,
      sender: this.cfg.senderId,
      message: message.body,
      recipient: message.to.replace(/^\+/, ''),
    };
    const templateId = message.templateId ?? this.cfg.dltTemplateId;
    if (templateId) body.template_id = templateId;
    if (this.cfg.dltEntityId) body.entity_id = this.cfg.dltEntityId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(this.cfg.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.error(`SMSLocal HTTP ${res.status}: ${text.slice(0, 300)}`);
        throw new ServiceUnavailableException('We could not send the SMS right now. Please try again.');
      }
      let id: string | undefined;
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        id = String(json.message_id ?? json.id ?? json.request_id ?? '') || undefined;
      } catch {
        /* non-JSON success body */
      }
      return { providerMessageId: id };
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.logger.error(`SMSLocal request failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('We could not send the SMS right now. Please try again.');
    } finally {
      clearTimeout(timer);
    }
  }
}
