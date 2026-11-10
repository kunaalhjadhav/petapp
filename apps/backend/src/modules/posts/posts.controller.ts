import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, OptionalAuth, RequestMeta, RequireFeature, type RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { PrismaService } from '../../prisma/prisma.service';
import { PostsService } from './posts.service';
import { CommentDto, CreatePostDto, CursorQuery, FeedQuery, ShareDto, UpdatePostDto, ViewDto } from './dto/posts.dto';

@ApiTags('Posts & reels')
@ApiBearerAuth()
@RequireFeature('ENABLE_REELS')
@Controller()
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly prisma: PrismaService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('posts')
  create(@CurrentUser() me: Principal, @Body() dto: CreatePostDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.posts.create(me.userId, dto, meta);
  }

  @OptionalAuth()
  @Get('posts/:id')
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me?: Principal) {
    return this.posts.get(id, await this.posts.viewer(me?.userId));
  }

  @Patch('posts/:id')
  update(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto) {
    return this.posts.update(me.userId, id, dto);
  }

  @Delete('posts/:id')
  async remove(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    await this.posts.remove(me.userId, id, meta);
    return null;
  }

  @Post('posts/:id/like')
  @HttpCode(200)
  async like(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.like(await this.posts.viewer(me.userId), id, true);
  }

  @Delete('posts/:id/like')
  async unlike(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.like(await this.posts.viewer(me.userId), id, false);
  }

  @Post('posts/:id/save')
  @HttpCode(200)
  async save(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.save(await this.posts.viewer(me.userId), id, true);
  }

  @Delete('posts/:id/save')
  async unsave(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.save(await this.posts.viewer(me.userId), id, false);
  }

  @Post('posts/:id/share')
  @HttpCode(200)
  async share(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShareDto) {
    return this.posts.share(await this.posts.viewer(me.userId), id, dto.channel);
  }

  @OptionalAuth()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Post('posts/:id/view')
  @HttpCode(200)
  async view(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ViewDto, @RequestMeta() meta: RequestMetaInfo, @CurrentUser() me?: Principal) {
    return this.posts.view(await this.posts.viewer(me?.userId), id, meta.ip, dto?.completed === true);
  }

  @OptionalAuth()
  @Get('posts/:id/comments')
  async comments(@Param('id', ParseUUIDPipe) id: string, @Query() q: CursorQuery, @CurrentUser() me?: Principal) {
    return this.posts.comments(await this.posts.viewer(me?.userId), id, null, q.cursor, q.limit);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('posts/:id/comments')
  async comment(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto) {
    return this.posts.addComment(await this.posts.viewer(me.userId), id, dto);
  }

  @OptionalAuth()
  @Get('comments/:id/replies')
  async replies(@Param('id', ParseUUIDPipe) id: string, @Query() q: CursorQuery, @CurrentUser() me?: Principal) {
    const parent = await this.prisma.comment.findUnique({ where: { id }, select: { postId: true } });
    return this.posts.comments(await this.posts.viewer(me?.userId), parent?.postId ?? id, id, q.cursor, q.limit);
  }

  @Delete('comments/:id')
  async deleteComment(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.posts.deleteComment(me.userId, id);
    return null;
  }

  /** Home feed: you and the people you follow, newest first. */
  @Get('feed')
  async feed(@CurrentUser() me: Principal, @Query() q: CursorQuery) {
    return this.posts.following(await this.posts.viewer(me.userId), q.cursor, q.limit);
  }

  /** Discovery and the Reels tab (kind=reels), ranked by trending score. */
  @OptionalAuth()
  @Get('feed/trending')
  async trending(@Query() q: FeedQuery, @CurrentUser() me?: Principal) {
    return this.posts.trending(await this.posts.viewer(me?.userId), q.cursor, q.limit, q.kind);
  }

  @OptionalAuth()
  @Get('hashtags/trending')
  trendingTags() {
    return this.posts.trendingHashtags();
  }

  @OptionalAuth()
  @Get('hashtags/:tag/posts')
  async byTag(@Param('tag') tag: string, @Query() q: CursorQuery, @CurrentUser() me?: Principal) {
    return this.posts.byHashtag(tag, await this.posts.viewer(me?.userId), q.cursor, q.limit);
  }

  @Get('users/me/saved')
  async saved(@CurrentUser() me: Principal, @Query() q: CursorQuery) {
    return this.posts.saved(await this.posts.viewer(me.userId), q.cursor, q.limit);
  }

  @OptionalAuth()
  @Get('users/:id/posts')
  async byUser(@Param('id', ParseUUIDPipe) id: string, @Query() q: CursorQuery, @CurrentUser() me?: Principal) {
    return this.posts.byAuthor(id, await this.posts.viewer(me?.userId), q.cursor, q.limit);
  }

  @OptionalAuth()
  @Get('pets/:id/posts')
  async byPet(@Param('id', ParseUUIDPipe) id: string, @Query() q: CursorQuery, @CurrentUser() me?: Principal) {
    return this.posts.byPet(id, await this.posts.viewer(me?.userId), q.cursor, q.limit);
  }
}
