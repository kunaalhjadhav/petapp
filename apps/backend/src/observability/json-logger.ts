import { ConsoleLogger, type LoggerService, type LogLevel } from '@nestjs/common';
import { currentContext } from './context';

const ORDER: Record<string, number> = { debug: 10, verbose: 10, log: 20, warn: 30, error: 40, fatal: 50 };
const LEVEL_NAME: Record<string, string> = { log: 'info', verbose: 'debug', debug: 'debug', warn: 'warn', error: 'error', fatal: 'fatal' };

/** Keys whose values are never written to logs. */
const SECRET = /^(pass(word)?|.*secret|.*token|authorization|otp|code|pan|account_?number|vpa|cookie|signature|.*key)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

/**
 * One JSON object per line (time, level, context, message, request id, user id and any extra fields), for log
 * collectors like CloudWatch, Loki or Datadog. LOG_FORMAT=pretty keeps Nest's coloured output for local work.
 */
export class JsonLogger implements LoggerService {
  private readonly min: number;
  private readonly pretty?: ConsoleLogger;

  constructor(
    level: 'debug' | 'info' | 'warn' | 'error' = 'info',
    format: 'json' | 'pretty' = 'json',
    private readonly service = 'api',
    private readonly write: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
  ) {
    this.min = ORDER[level === 'info' ? 'log' : level];
    if (format === 'pretty') {
      this.pretty = new ConsoleLogger();
      this.pretty.setLogLevels((Object.keys(ORDER) as LogLevel[]).filter((l) => ORDER[l] >= this.min));
    }
  }

  static fromEnv(env: NodeJS.ProcessEnv, service: string) {
    const live = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
    const format = env.LOG_FORMAT === 'json' || env.LOG_FORMAT === 'pretty' ? env.LOG_FORMAT : live ? 'json' : 'pretty';
    const level = (['debug', 'info', 'warn', 'error'] as const).find((l) => l === env.LOG_LEVEL) ?? 'info';
    return new JsonLogger(level, format, service);
  }

  log(message: unknown, ...rest: unknown[]) {
    this.emit('log', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.emit('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.emit('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.emit('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.emit('verbose', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]) {
    this.emit('fatal', message, rest);
  }

  /** A structured event: `logger.event('info', 'request', { method, route, status, ms })`. */
  event(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown>) {
    const key = level === 'info' ? 'log' : level;
    if (ORDER[key] < this.min) return;
    if (this.pretty) return this.pretty[key](`${msg} ${JSON.stringify(fields)}`);
    this.line(level, msg, undefined, fields);
  }

  private emit(level: string, message: unknown, rest: unknown[]) {
    if (ORDER[level] < this.min) return;
    // Nest passes (message, context) or, for errors, (message, stack, context).
    const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    const stack = level === 'error' && rest.length >= 2 && typeof rest[0] === 'string' ? (rest[0] as string) : undefined;
    if (this.pretty) {
      const fn = this.pretty[level as 'log'].bind(this.pretty) as (...a: unknown[]) => void;
      return context ? fn(message, ...(stack ? [stack] : []), context) : fn(message);
    }
    const fields: Record<string, unknown> = {};
    let msg: string;
    if (message instanceof Error) {
      msg = message.message;
      fields.stack = message.stack;
    } else if (message && typeof message === 'object') {
      msg = String((message as { message?: unknown }).message ?? '');
      Object.assign(fields, redact(message));
      delete fields.message;
    } else msg = String(message);
    if (stack) fields.stack = stack;
    this.line(LEVEL_NAME[level], msg, context, fields);
  }

  private line(level: string, msg: string, context: string | undefined, fields: Record<string, unknown>) {
    const c = currentContext();
    this.write(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        service: this.service,
        ...(context ? { context } : {}),
        msg,
        ...(c ? { requestId: c.requestId, ...(c.userId ? { userId: c.userId } : {}) } : {}),
        ...fields,
      }),
    );
  }
}
