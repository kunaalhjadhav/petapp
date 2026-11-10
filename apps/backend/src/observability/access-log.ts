import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { routeOf } from './metrics';

const QUIET = new Set(['/health', '/ready', '/metrics']);

/**
 * One log line per request: method, route pattern, status and time. Never the query string or body (they can hold
 * tokens, OTPs or personal data). Slow (over 1 s) and failed (5xx) requests are logged as warnings.
 */
export function accessLog(logger = new Logger('HTTP')) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (QUIET.has(req.path)) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const entry = { message: `${req.method} ${routeOf(req)} ${res.statusCode}`, method: req.method, route: routeOf(req), status: res.statusCode, ms: Math.round(ms) };
      if (res.statusCode >= 500 || ms > 1000) logger.warn(entry);
      else logger.log(entry);
    });
    next();
  };
}
