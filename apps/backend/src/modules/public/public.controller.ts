import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/auth.decorators';
import { PublicService } from './public.service';

@ApiTags('Public web')
@Controller('public')
export class PublicController {
  constructor(private readonly pub: PublicService) {}

  /**
   * Everything the website may list in its sitemap: public pets (by handle), products, service partners, contests,
   * challenges and published legal documents (by slug), with when each last changed. Cached for 10 minutes.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('sitemap')
  sitemap() {
    return this.pub.sitemap();
  }
}
