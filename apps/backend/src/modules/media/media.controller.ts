import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { MediaService } from './media.service';
import { CreateUploadDto, PartUrlsDto } from './dto/media.dto';

@ApiTags('Media')
@ApiBearerAuth()
/** Feature switches are checked per upload kind in MediaService (photos/videos: Reels; documents: Services or Marketplace). */
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Step 1: get a signed URL, then PUT the file to it with the returned headers. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('uploads')
  create(@CurrentUser() me: Principal, @Body() dto: CreateUploadDto) {
    return this.media.createUpload(me.userId, dto);
  }

  /** Resumable uploads (method MULTIPART): signed addresses for the next parts. PUT each part's bytes to its URL. */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post(':id/parts')
  @HttpCode(200)
  parts(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PartUrlsDto) {
    return this.media.partUrls(me.userId, id, dto.partNumbers);
  }

  /** Resumable uploads: which parts have arrived (after a dropped connection, send only the missing ones). */
  @Get(':id/upload')
  status(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.uploadStatus(me.userId, id);
  }

  /** Step 2: confirm the upload; processing starts. Poll GET /media/:id until READY. */
  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.complete(me.userId, id);
  }

  @Get(':id')
  get(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.get(me.userId, id);
  }
}
