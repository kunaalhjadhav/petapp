import { HttpException, NotFoundException } from '@nestjs/common';
import { JsonLogger, redact } from './json-logger';
import { SentryTracker, frames, parseDsn, trackerFromEnv } from './error-tracker';
import { requestContext, setContextUser } from './context';
import { routeOf } from './metrics';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';

describe('structured logging', () => {
  const capture = (level: 'debug' | 'info' | 'warn' | 'error' = 'info') => {
    const lines: Array<Record<string, unknown>> = [];
    return { lines, logger: new JsonLogger(level, 'json', 'api', (l) => lines.push(JSON.parse(l))) };
  };

  it('writes one JSON object per line with the request id and user, and the Nest context', () => {
    const { lines, logger } = capture();
    requestContext.run({ requestId: 'req-12345678' }, () => {
      setContextUser('user-1');
      logger.log('booking confirmed', 'BookingsService');
    });
    logger.warn('outside a request');
    expect(lines[0]).toMatchObject({ level: 'info', service: 'api', context: 'BookingsService', msg: 'booking confirmed', requestId: 'req-12345678', userId: 'user-1' });
    expect(typeof lines[0].time).toBe('string');
    expect(lines[1]).toEqual({ time: expect.any(String), level: 'warn', service: 'api', msg: 'outside a request' });
  });

  it('keeps stacks for errors, structured fields for objects, and drops levels below the minimum', () => {
    const { lines, logger } = capture('warn');
    logger.log('ignored');
    logger.debug('ignored');
    logger.error('boom', 'Error: boom\n    at x (a.ts:1:1)', 'Payments');
    logger.warn({ message: 'GET /x 500', route: '/x', status: 500, otp: '123456', headers: { authorization: 'Bearer abc' } });
    logger.error(new Error('kaput'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ level: 'error', context: 'Payments', msg: 'boom', stack: expect.stringContaining('a.ts:1:1') });
    expect(lines[1]).toMatchObject({ msg: 'GET /x 500', route: '/x', status: 500, otp: '[redacted]', headers: { authorization: '[redacted]' } });
    expect(lines[2]).toMatchObject({ msg: 'kaput', stack: expect.stringContaining('Error: kaput') });
  });

  it('redacts secrets by key, at any depth, but not ordinary words', () => {
    expect(redact({ password: 'x', refreshToken: 'y', apiKey: 'z', company: 'Acme', nested: { vpa: 'a@b', pan: 'ABCDE1234F', city: 'Pune' } })).toEqual({
      password: '[redacted]',
      refreshToken: '[redacted]',
      apiKey: '[redacted]',
      company: 'Acme',
      nested: { vpa: '[redacted]', pan: '[redacted]', city: 'Pune' },
    });
  });

  it('defaults: JSON in staging/production, readable output locally', () => {
    expect((JsonLogger.fromEnv({ NODE_ENV: 'production' }, 'api') as unknown as { pretty?: unknown }).pretty).toBeUndefined();
    expect((JsonLogger.fromEnv({ NODE_ENV: 'development' }, 'api') as unknown as { pretty?: unknown }).pretty).toBeDefined();
    expect((JsonLogger.fromEnv({ NODE_ENV: 'development', LOG_FORMAT: 'json' }, 'api') as unknown as { pretty?: unknown }).pretty).toBeUndefined();
  });
});

describe('error tracking', () => {
  it('reads a Sentry DSN', () => {
    expect(parseDsn('https://abc123@o1.ingest.sentry.io/4507')).toEqual({ url: 'https://o1.ingest.sentry.io/api/4507/envelope/', dsn: 'https://abc123@o1.ingest.sentry.io/4507' });
    expect(() => parseDsn('https://o1.ingest.sentry.io/4507')).toThrow(/look like/);
  });

  it('turns a V8 stack into frames, oldest first, marking library code', () => {
    const f = frames('Error: x\n    at handler (/app/dist/a.js:10:5)\n    at /app/node_modules/express/lib/router.js:1:2\n    at process.tick (node:internal/x:3:4)');
    expect(f).toEqual([
      { function: '?', filename: 'node:internal/x', lineno: 3, colno: 4, in_app: false },
      { function: '?', filename: '/app/node_modules/express/lib/router.js', lineno: 1, colno: 2, in_app: false },
      { function: 'handler', filename: '/app/dist/a.js', lineno: 10, colno: 5, in_app: true },
    ].map((x, i) => (i === 0 ? { ...x, function: 'process.tick' } : x)));
  });

  it('sends an envelope with the error, request id, user and tags, and stops at the per-minute cap', async () => {
    const sent: Array<{ url: string; body: string }> = [];
    const fetchFn = jest.fn(async (url: string, init: { body: string }) => (sent.push({ url, body: init.body }), new Response('{}')));
    const t = new SentryTracker('https://key@sentry.example.com/42', 'staging', 'abc123', 'api', fetchFn as unknown as typeof fetch, 2);
    requestContext.run({ requestId: 'req-abcdefgh', userId: 'u-9' }, () => t.capture(new TypeError('bad thing'), { tags: { route: 'GET /x' } }));
    t.capture('second');
    t.capture('third (over the cap)');
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toHaveLength(2);
    expect(sent[0].url).toBe('https://sentry.example.com/api/42/envelope/');
    const [header, item, event] = sent[0].body.split('\n').map((l) => JSON.parse(l));
    expect(header).toMatchObject({ dsn: 'https://key@sentry.example.com/42', event_id: event.event_id });
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({
      platform: 'node', level: 'error', environment: 'staging', release: 'abc123', server_name: 'api',
      tags: { service: 'api', request_id: 'req-abcdefgh', route: 'GET /x' }, user: { id: 'u-9' },
      exception: { values: [{ type: 'TypeError', value: 'bad thing' }] },
    });
  });

  it('is off unless configured', () => {
    expect(trackerFromEnv({}, 'api').name).toBe('none');
    expect(trackerFromEnv({ ERROR_TRACKER: 'sentry' }, 'api').name).toBe('none');
    expect(trackerFromEnv({ ERROR_TRACKER: 'sentry', SENTRY_DSN: 'https://k@h.io/1' }, 'api').name).toBe('sentry');
  });

  it('the API reports unexpected errors, not ordinary 4xx answers, and hides the details from the caller', () => {
    const tracker = { name: 'test', capture: jest.fn() };
    const filter = new AllExceptionsFilter(tracker);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'r1', method: 'GET', path: '/x', route: { path: '/x' } }) }) } as never;
    filter.catch(new NotFoundException('Nope'), host);
    filter.catch(new HttpException('Conflict', 409), host);
    expect(tracker.capture).not.toHaveBeenCalled();
    filter.catch(new Error('db password is hunter2'), host);
    expect(tracker.capture).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenLastCalledWith(500);
    expect(res.json).toHaveBeenLastCalledWith({ success: false, message: 'Something went wrong. Please try again.', errors: [], requestId: 'r1' });
  });
});

describe('metrics labels', () => {
  it('use the route pattern, never the raw URL', () => {
    expect(routeOf({ baseUrl: '', route: { path: '/api/v1/posts/:id' } } as never)).toBe('/api/v1/posts/:id');
    expect(routeOf({ baseUrl: '' } as never)).toBe('unmatched');
  });
});
