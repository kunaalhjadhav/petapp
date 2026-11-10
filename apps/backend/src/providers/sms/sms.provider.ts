export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsMessage {
  to: string; // E.164
  body: string;
  /** DLT template id (India) when the provider requires it. */
  templateId?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<{ providerMessageId?: string }>;
}
