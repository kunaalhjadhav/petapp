import { AsyncLocalStorage } from 'async_hooks';

/** Per-request context, so every log line and error report can carry the request id and the signed-in user. */
export interface RequestContext {
  requestId: string;
  userId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const currentContext = (): RequestContext | undefined => requestContext.getStore();

/** Called by the auth guard once the caller is known. */
export function setContextUser(userId: string | undefined) {
  const c = requestContext.getStore();
  if (c && userId) c.userId = userId;
}
