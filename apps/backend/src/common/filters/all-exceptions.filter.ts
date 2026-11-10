import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject, Logger, Optional } from '@nestjs/common';
import { ERROR_TRACKER, type ErrorTracker } from '../../observability/error-tracker';
import { ThrottlerException } from '@nestjs/throttler';
import type { ApiError } from '@petapp/types';
import { Prisma } from '../../generated/prisma/client';

type ErrItem = ApiError['errors'][number];

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(@Optional() @Inject(ERROR_TRACKER) private readonly tracker?: ErrorTracker) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong. Please try again.';
    let errors: ErrItem[] = [];

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      message = 'Too many requests. Please slow down and try again shortly.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; errors?: ErrItem[] };
        if (Array.isArray(b.message)) {
          message = 'Validation failed';
          errors = b.message.map((m) => ({ message: m }));
        } else if (b.message) {
          message = b.message;
        }
        if (Array.isArray(b.errors)) errors = b.errors;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'A record with these details already exists.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Record not found.';
      } else {
        this.logger.error(`Prisma ${exception.code}: ${exception.message}`);
        this.tracker?.capture(exception, { tags: { route: `${req.method} ${req.route?.path ?? 'unmatched'}` } });
      }
    } else {
      const err = exception as Error;
      this.logger.error(`${req.method} ${req.route?.path ?? req.path} → ${err?.message}`, err?.stack);
      this.tracker?.capture(exception, { tags: { route: `${req.method} ${req.route?.path ?? 'unmatched'}` } });
    }

    const payload: ApiError = { success: false, message, errors, requestId: req.id };
    res.status(status).json(payload);
  }
}
