import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { ApiSuccess } from '@petapp/types';
import { Paged, WithMessage } from '../dto/pagination.dto';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<ApiSuccess<unknown>> {
    const req = ctx.switchToHttp().getRequest();
    return next.handle().pipe(
      map((body) => {
        // Files (e.g. invoice PDFs) go out as they are, not wrapped in the JSON envelope.
        if (body instanceof StreamableFile) return body as unknown as ApiSuccess<unknown>;
        const meta: Record<string, unknown> = { requestId: req.id };
        if (body instanceof Paged) {
          return { success: true, data: body.items, message: 'Success', meta: { ...meta, ...body.meta } };
        }
        if (body instanceof WithMessage) {
          return { success: true, data: body.data, message: body.message, meta };
        }
        return { success: true, data: body ?? null, message: 'Success', meta };
      }),
    );
  }
}
