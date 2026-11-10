import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, OptionalAuth } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { SearchService } from './search.service';
import { SearchQuery, SearchTypeParam } from './search.dto';

@ApiTags('Search')
@ApiBearerAuth()
@OptionalAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** The best few of every kind ("All"). */
  @Get() all(@Query() q: SearchQuery, @CurrentUser() me?: Principal) {
    return this.search.all(q.q, me?.userId, q);
  }

  /** The filters each kind offers, with their choices. */
  @Get('filters') filters() {
    return this.search.filters();
  }

  /** One kind, paged, with its filters. */
  @Get(':type') one(@Param() p: SearchTypeParam, @Query() q: SearchQuery, @CurrentUser() me?: Principal) {
    return this.search.one(p.type, q, me?.userId);
  }
}
