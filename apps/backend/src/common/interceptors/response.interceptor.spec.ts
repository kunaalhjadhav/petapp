import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';
import { Paged, WithMessage } from '../dto/pagination.dto';

const ctx = { switchToHttp: () => ({ getRequest: () => ({ id: 'req-1' }) }) } as unknown as ExecutionContext;
const run = (body: unknown) => lastValueFrom(new ResponseInterceptor().intercept(ctx, { handle: () => of(body) } as CallHandler));

describe('ResponseInterceptor', () => {
  it('wraps plain data', async () => {
    expect(await run({ a: 1 })).toEqual({ success: true, data: { a: 1 }, message: 'Success', meta: { requestId: 'req-1' } });
  });
  it('maps undefined to null', async () => {
    expect((await run(undefined)).data).toBeNull();
  });
  it('puts pagination into meta', async () => {
    const res = await run(Paged.of([1, 2], 45, { page: 2, limit: 20 }));
    expect(res.data).toEqual([1, 2]);
    expect(res.meta).toMatchObject({ page: 2, limit: 20, total: 45, totalPages: 3 });
  });
  it('supports custom messages', async () => {
    expect((await run(new WithMessage(null, 'Done'))).message).toBe('Done');
  });
});
