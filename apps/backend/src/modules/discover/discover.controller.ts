import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, OptionalAuth, RequireFeature } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { DiscoverService } from './discover.service';
import { DiscoverLimitQuery, DiscoverReelsQuery, NearbyPetsQuery } from './discover.dto';

@ApiTags('Discover')
@ApiBearerAuth()
@OptionalAuth()
@Controller('discover')
export class DiscoverController {
  constructor(private readonly discover: DiscoverService) {}

  @Get('pets/trending') trending(@Query() q: DiscoverLimitQuery, @CurrentUser() me?: Principal) {
    return this.discover.trendingPets(me?.userId, q.limit);
  }

  @Get('pets/nearby') nearby(@Query() q: NearbyPetsQuery, @CurrentUser() me?: Principal) {
    return this.discover.nearbyPets(me?.userId, q);
  }

  @RequireFeature('ENABLE_REELS') @Get('reels') reels(@Query() q: DiscoverReelsQuery, @CurrentUser() me?: Principal) {
    return this.discover.popularReels(me?.userId, q.cursor, q.limit);
  }

  @RequireFeature('ENABLE_CONTESTS') @Get('contest-entries') contestEntries(@Query() q: DiscoverLimitQuery, @CurrentUser() me?: Principal) {
    return this.discover.contestEntries(me?.userId, q.limit);
  }

  @RequireFeature('ENABLE_CONTESTS') @Get('challenge-entries') challengeEntries(@Query() q: DiscoverLimitQuery, @CurrentUser() me?: Principal) {
    return this.discover.challengeEntries(me?.userId, q.limit);
  }
}
