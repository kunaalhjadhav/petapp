import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailProvider } from './email.provider';

/** Any SMTP service (Amazon SES, SendGrid, Mailgun, Zoho, Google Workspace …). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly canSend = true;
  private readonly transport: Transporter;

  constructor(
    o: { host: string; port: number; secure: boolean; user: string; pass: string },
    private readonly from: string,
  ) {
    this.transport = createTransport({
      host: o.host,
      port: o.port,
      secure: o.secure,
      // STARTTLS is required on a non-TLS port: credentials never travel in the clear.
      requireTLS: !o.secure,
      auth: { user: o.user, pass: o.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(m: EmailMessage) {
    const r = await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return { providerMessageId: r.messageId };
  }
}
