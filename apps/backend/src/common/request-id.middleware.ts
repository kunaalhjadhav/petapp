import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from '../observability/context';

/** Attaches a request id (honours a sane incoming X-Request-Id) and echoes it back. */
export function requestIdMiddleware(req: Request & { id?: string }, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  // Everything logged or reported while handling this request carries its id (and the user, once signed in).
  requestContext.run({ requestId: req.id }, next);
}
