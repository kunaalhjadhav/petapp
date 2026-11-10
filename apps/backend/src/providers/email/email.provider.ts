export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text: always sent, and all a reader needs. */
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  /** False when no email can be sent (EMAIL_PROVIDER=none): callers say so instead of pretending. */
  readonly canSend: boolean;
  send(message: EmailMessage): Promise<{ providerMessageId?: string }>;
}

/** Nothing configured: nothing is sent. */
export class NoEmailProvider implements EmailProvider {
  readonly name = 'none';
  readonly canSend = false;
  async send(): Promise<{ providerMessageId?: string }> {
    throw new Error('Email is not configured (EMAIL_PROVIDER=none).');
  }
}
