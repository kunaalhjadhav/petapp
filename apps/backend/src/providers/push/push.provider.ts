import { Logger } from '@nestjs/common';
import { JWT } from 'google-auth-library';

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** String-only payload for the app (deep link target etc.). */
  data: Record<string, string>;
}

export type PushResult = 'sent' | 'invalid-token' | 'failed';

export interface PushProvider {
  readonly name: string;
  send(m: PushMessage): Promise<PushResult>;
}

export class NoopPushProvider implements PushProvider {
  readonly name = 'none';
  async send(): Promise<PushResult> {
    return 'sent';
  }
}

export class ConsolePushProvider implements PushProvider {
  readonly name = 'console';
  private readonly logger = new Logger('Push');
  async send(m: PushMessage): Promise<PushResult> {
    this.logger.log(`[DEV PUSH …${m.token.slice(-6)}] ${m.title}: ${m.body} ${JSON.stringify(m.data)}`);
    return 'sent';
  }
}

type FetchFn = typeof fetch;

/** Firebase Cloud Messaging HTTP v1. Tokens FCM reports as unregistered are returned as invalid so callers delete them. */
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';
  private readonly logger = new Logger('FCM');
  private readonly auth: JWT;

  constructor(
    private readonly projectId: string,
    clientEmail: string,
    privateKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.auth = new JWT({ email: clientEmail, key: privateKey.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
  }

  async send(m: PushMessage): Promise<PushResult> {
    const { token } = await this.auth.getAccessToken();
    const res = await this.fetchFn(`https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: m.token,
          notification: { title: m.title, body: m.body },
          data: m.data,
          android: { priority: 'HIGH', notification: { channel_id: 'activity' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (res.ok) return 'sent';
    const text = await res.text();
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) return 'invalid-token';
    if (res.status === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text)) return 'invalid-token';
    this.logger.warn(`FCM ${res.status}: ${text.slice(0, 200)}`);
    if (res.status >= 500 || res.status === 429) throw new Error(`FCM temporarily unavailable (${res.status})`); // let the job retry
    return 'failed';
  }
}
