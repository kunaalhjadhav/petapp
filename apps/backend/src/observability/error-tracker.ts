import { randomUUID } from 'crypto';
import { currentContext } from './context';

export const ERROR_TRACKER = Symbol('ERROR_TRACKER');

export interface ErrorTracker {
  readonly name: string;
  /** Report an unexpected error. Never throws, never blocks the caller. */
  capture(error: unknown, extra?: { tags?: Record<string, string>; context?: Record<string, unknown> }): void;
}

export class NoopTracker implements ErrorTracker {
  readonly name = 'none';
  capture() {}
}

interface Dsn {
  url: string;
  dsn: string;
}

/** "https://<key>@<host>/<project>" → the envelope endpoint. */
export function parseDsn(dsn: string): Dsn {
  const u = new URL(dsn);
  const project = u.pathname.replace(/^\/+|\/+$/g, '');
  if (!u.username || !project) throw new Error('SENTRY_DSN must look like https://<key>@<host>/<project>');
  return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, dsn };
}

/** Stack frames in Sentry's format (oldest first), from a V8 stack trace. */
export function frames(stack: string | undefined) {
  return (stack ?? '')
    .split('\n')
    .slice(1)
    .map((l) => l.trim().match(/^at (?:(.+?) \()?(.*?):(\d+):(\d+)\)?$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ function: m[1] ?? '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: !m[2].includes('node_modules') && !m[2].startsWith('node:') }))
    .reverse();
}

/**
 * Sends events to Sentry (or a compatible service such as GlitchTip) through the envelope HTTP API, so no SDK is
 * needed. At most `maxPerMinute` events are sent, so an error storm can't flood the service or the network.
 */
export class SentryTracker implements ErrorTracker {
  readonly name = 'sentry';
  private readonly target: Dsn;
  private window = 0;
  private sent = 0;

  constructor(
    dsn: string,
    private readonly environment: string,
    private readonly release: string | undefined,
    private readonly service: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly maxPerMinute = 60,
  ) {
    this.target = parseDsn(dsn);
  }

  capture(error: unknown, extra: { tags?: Record<string, string>; context?: Record<string, unknown> } = {}) {
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== this.window) [this.window, this.sent] = [minute, 0];
    if (++this.sent > this.maxPerMinute) return;
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));
    const c = currentContext();
    const eventId = randomUUID().replace(/-/g, '');
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      environment: this.environment,
      release: this.release,
      server_name: this.service,
      tags: { service: this.service, ...(c ? { request_id: c.requestId } : {}), ...extra.tags },
      user: c?.userId ? { id: c.userId } : undefined,
      extra: extra.context,
      exception: { values: [{ type: err.name, value: err.message.slice(0, 1000), stacktrace: { frames: frames(err.stack) } }] },
    };
    const body = [JSON.stringify({ event_id: eventId, dsn: this.target.dsn, sent_at: new Date().toISOString() }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
    void this.fetchFn(this.target.url, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope' }, body, signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  }
}

export function trackerFromEnv(env: NodeJS.ProcessEnv, service: string): ErrorTracker {
  if (env.ERROR_TRACKER === 'sentry' && env.SENTRY_DSN) return new SentryTracker(env.SENTRY_DSN, env.NODE_ENV ?? 'development', env.APP_RELEASE, service);
  return new NoopTracker();
}
