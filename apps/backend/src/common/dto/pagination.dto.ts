import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { PageMeta } from '@petapp/types';

export class PaginationQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/** Return this from a controller to get pagination in `meta`. */
export class Paged<T> {
  constructor(
    readonly items: T[],
    readonly meta: PageMeta,
  ) {}

  static of<T>(items: T[], total: number, q: { page: number; limit: number }): Paged<T> {
    return new Paged(items, { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) });
  }
}

/** Return this to set a custom success message. */
export class WithMessage<T> {
  constructor(
    readonly data: T,
    readonly message: string,
  ) {}
}
