import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { MediaService, type MediaView } from '../media/media.service';
import { ActivityService } from '../analytics/activity.service';
import { QueueService } from '../../queue/queue.service';
import { Prisma } from '../../generated/prisma/client';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { decodeCursor, decodeOffset, encodeCursor, encodeOffset, extractHashtags } from './text';
import type { CommentDto, CreatePostDto, UpdatePostDto } from './dto/posts.dto';

/** Who is looking: drives visibility, block filtering and "liked/saved" flags. */
export interface Viewer {
  id?: string;
  following: Set<string>;
  blocked: Set<string>; // either direction
}

const POST_INCLUDE = {
  author: { select: { id: true, name: true, avatarUrl: true, status: true } },
  media: { orderBy: { position: 'asc' as const }, include: { media: true } },
  pets: { include: { pet: { select: { id: true, name: true, handle: true, avatarUrl: true } } } },
  hashtags: { include: { hashtag: { select: { tag: true } } } },
} satisfies Prisma.PostInclude;

type FullPost = Prisma.PostGetPayload<{ include: typeof POST_INCLUDE }>;

const MAX_PAGE = 50;

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly platform: PlatformService,
    private readonly mediaSvc: MediaService,
    private readonly queue: QueueService,
    private readonly activity: ActivityService,
  ) {}

  // ───────────── viewer context ─────────────

  async viewer(userId?: string): Promise<Viewer> {
    if (!userId) return { following: new Set(), blocked: new Set() };
    const [follows, blocks] = await Promise.all([
      this.prisma.userFollower.findMany({ where: { followerId: userId }, select: { followingId: true } }),
      this.prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } }),
    ]);
    return {
      id: userId,
      following: new Set(follows.map((f) => f.followingId)),
      blocked: new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId))),
    };
  }

  /** Posts this viewer may see in lists. */
  private visibleWhere(v: Viewer): Prisma.PostWhereInput {
    return {
      status: 'PUBLISHED',
      deletedAt: null,
      author: { status: 'ACTIVE' },
      ...(v.blocked.size ? { authorId: { notIn: [...v.blocked] } } : {}),
      OR: [{ visibility: 'PUBLIC' }, ...(v.id ? [{ authorId: v.id }, { authorId: { in: [...v.following] } }] : [])],
    };
  }

  private canView(p: Pick<FullPost, 'status' | 'deletedAt' | 'authorId' | 'visibility'> & { author: { status: string } }, v: Viewer): boolean {
    if (p.deletedAt || p.author.status !== 'ACTIVE' || v.blocked.has(p.authorId)) return false;
    if (v.id === p.authorId) return p.status !== 'REMOVED';
    if (p.status !== 'PUBLISHED') return false;
    return p.visibility === 'PUBLIC' || (!!v.id && v.following.has(p.authorId));
  }

  // ───────────── create / edit / delete ─────────────

  async create(authorId: string, dto: CreatePostDto, meta: RequestMetaInfo) {
    const max = await this.platform.getSetting<number>('posts.maxMediaPerPost');
    if (dto.mediaIds.length > max) throw new BadRequestException(`A post can have up to ${max} photos or videos.`);

    const media = await this.prisma.mediaAsset.findMany({
      where: { id: { in: dto.mediaIds }, ownerId: authorId },
      include: { _count: { select: { posts: true } } },
    });
    if (media.length !== dto.mediaIds.length) throw new BadRequestException('One or more uploads were not found.');
    if (media.some((m) => m._count.posts > 0)) throw new BadRequestException('An upload can only be used in one post.');
    if (media.some((m) => !['UPLOADED', 'PROCESSING', 'READY'].includes(m.status))) {
      throw new BadRequestException('One or more uploads are not finished or could not be processed. Upload them again.');
    }
    const kinds = media.map((m) => m.kind);
    if (dto.type === 'PHOTO' && kinds.some((k) => k !== 'IMAGE')) throw new BadRequestException('Photo posts can only contain images.');
    if ((dto.type === 'REEL' || dto.type === 'VIDEO') && (media.length !== 1 || kinds[0] !== 'VIDEO')) {
      throw new BadRequestException(`A ${dto.type === 'REEL' ? 'reel' : 'video post'} needs exactly one video.`);
    }

    const petIds = dto.petIds ?? [];
    if (petIds.length) {
      const pets = await this.prisma.pet.count({ where: { id: { in: petIds }, deletedAt: null, status: 'ACTIVE', OR: [{ ownerId: authorId }, { visibility: 'PUBLIC' }] } });
      if (pets !== petIds.length) throw new BadRequestException('One or more tagged pets can’t be tagged.');
    }

    const ready = media.every((m) => m.status === 'READY');
    const tags = extractHashtags(dto.caption);
    const order = new Map(dto.mediaIds.map((id, i) => [id, i]));

    const post = await this.prisma.$transaction(async (tx) => {
      const hashtags = await this.upsertHashtags(tx, tags);
      const p = await tx.post.create({
        data: {
          authorId,
          type: dto.type,
          caption: dto.caption || null,
          locationName: dto.locationName,
          latitude: dto.latitude,
          longitude: dto.longitude,
          visibility: dto.visibility ?? 'PUBLIC',
          status: ready ? 'PUBLISHED' : 'PROCESSING',
          publishedAt: ready ? new Date() : null,
          media: { create: media.map((m) => ({ mediaId: m.id, position: order.get(m.id)! })) },
          pets: { create: petIds.map((petId) => ({ petId })) },
          hashtags: { create: hashtags.map((hashtagId) => ({ hashtagId })) },
        },
      });
      await this.audit.log({ actorId: authorId, action: 'post.create', entityType: 'Post', entityId: p.id, after: { type: dto.type, media: dto.mediaIds.length }, meta }, tx);
      return p;
    });
    // Published straight away: no "your post is live" notice, but mentioned pets' owners hear about it.
    if (ready) {
      this.queue.notify({ type: 'POST_PUBLISHED', postId: post.id, quiet: true });
      this.queue.assess('POST', post.id);
    }
    return this.get(post.id, await this.viewer(authorId));
  }

  async update(authorId: string, id: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findFirst({ where: { id, authorId, deletedAt: null }, include: { hashtags: { include: { hashtag: true } } } });
    if (!post) throw new NotFoundException('Post not found.');
    await this.prisma.$transaction(async (tx) => {
      if (dto.caption !== undefined) {
        const next = extractHashtags(dto.caption);
        const current = post.hashtags.map((h) => h.hashtag.tag);
        const removed = post.hashtags.filter((h) => !next.includes(h.hashtag.tag)).map((h) => h.hashtagId);
        const added = await this.upsertHashtags(tx, next.filter((t) => !current.includes(t)));
        if (removed.length) {
          await tx.postHashtag.deleteMany({ where: { postId: id, hashtagId: { in: removed } } });
          await tx.hashtag.updateMany({ where: { id: { in: removed } }, data: { postCount: { decrement: 1 } } });
        }
        if (added.length) await tx.postHashtag.createMany({ data: added.map((hashtagId) => ({ postId: id, hashtagId })) });
      }
      await tx.post.update({ where: { id }, data: { caption: dto.caption === undefined ? undefined : dto.caption || null, visibility: dto.visibility, locationName: dto.locationName } });
    });
    if (dto.caption !== undefined) this.queue.assess('POST', id); // a changed caption is checked again
    return this.get(id, await this.viewer(authorId));
  }

  async remove(authorId: string, id: string, meta: RequestMetaInfo) {
    const post = await this.prisma.post.findFirst({ where: { id, authorId, deletedAt: null }, select: { id: true, hashtags: { select: { hashtagId: true } } } });
    if (!post) throw new NotFoundException('Post not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.post.update({ where: { id }, data: { deletedAt: new Date(), status: 'REMOVED' } });
      const ids = post.hashtags.map((h) => h.hashtagId);
      if (ids.length) await tx.hashtag.updateMany({ where: { id: { in: ids } }, data: { postCount: { decrement: 1 } } });
      await this.audit.log({ actorId: authorId, action: 'post.delete', entityType: 'Post', entityId: id, meta }, tx);
    });
  }

  /** Each tag gets a row; postCount counts posts using it. Returns hashtag ids. */
  private async upsertHashtags(tx: Prisma.TransactionClient, tags: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const tag of tags) {
      const h = await tx.hashtag.upsert({ where: { tag }, update: { postCount: { increment: 1 } }, create: { tag, postCount: 1 } });
      ids.push(h.id);
    }
    return ids;
  }

  // ───────────── read ─────────────

  async get(id: string, v: Viewer) {
    const post = await this.prisma.post.findUnique({ where: { id }, include: POST_INCLUDE });
    if (!post || !this.canView(post, v)) throw new NotFoundException('Post not found.');
    return (await this.present([post], v))[0];
  }

  /** Home feed: people you follow and you, newest first. Keyset-paginated, so it never repeats or skips. */
  async following(v: Viewer, cursorStr: string | undefined, limit: number) {
    if (!v.id) throw new ForbiddenException();
    const c = decodeCursor(cursorStr);
    const take = Math.min(limit, MAX_PAGE);
    const posts = await this.prisma.post.findMany({
      where: {
        AND: [
          this.visibleWhere(v),
          { authorId: { in: [v.id, ...v.following] } },
          c ? { OR: [{ publishedAt: { lt: c.date } }, { publishedAt: c.date, id: { lt: c.id } }] } : {},
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: POST_INCLUDE,
    });
    return this.page(posts, take, v, (p) => encodeCursor(p.publishedAt!, p.id));
  }

  /** Discovery: ranked by the trending score (public posts only). Reels-only when kind = reels. */
  async trending(v: Viewer, cursorStr: string | undefined, limit: number, kind: 'all' | 'reels' = 'all') {
    const offset = decodeOffset(cursorStr);
    const take = Math.min(limit, MAX_PAGE);
    const posts = await this.prisma.post.findMany({
      where: { AND: [this.visibleWhere(v), { visibility: 'PUBLIC' }, kind === 'reels' ? { type: 'REEL' } : {}] },
      orderBy: [{ score: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: take + 1,
      include: POST_INCLUDE,
    });
    return this.page(posts, take, v, () => encodeOffset(offset + take));
  }

  async byHashtag(tag: string, v: Viewer, cursorStr: string | undefined, limit: number) {
    const h = await this.prisma.hashtag.findUnique({ where: { tag: tag.toLowerCase().replace(/^#/, '') } });
    if (!h) return { hashtag: { tag, postCount: 0 }, items: [], nextCursor: null };
    const res = await this.keyset({ hashtags: { some: { hashtagId: h.id } }, visibility: 'PUBLIC' }, v, cursorStr, limit);
    return { hashtag: { tag: h.tag, postCount: h.postCount }, ...res };
  }

  byAuthor(authorId: string, v: Viewer, cursorStr: string | undefined, limit: number) {
    if (v.blocked.has(authorId)) return { items: [], nextCursor: null };
    return this.keyset({ authorId }, v, cursorStr, limit);
  }

  byPet(petId: string, v: Viewer, cursorStr: string | undefined, limit: number) {
    return this.keyset({ pets: { some: { petId } } }, v, cursorStr, limit);
  }

  async saved(v: Viewer, cursorStr: string | undefined, limit: number) {
    return this.keyset({ saves: { some: { userId: v.id } } }, v, cursorStr, limit);
  }

  private async keyset(extra: Prisma.PostWhereInput, v: Viewer, cursorStr: string | undefined, limit: number) {
    const c = decodeCursor(cursorStr);
    const take = Math.min(limit, MAX_PAGE);
    const posts = await this.prisma.post.findMany({
      where: { AND: [this.visibleWhere(v), extra, c ? { OR: [{ publishedAt: { lt: c.date } }, { publishedAt: c.date, id: { lt: c.id } }] } : {}] },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: POST_INCLUDE,
    });
    return this.page(posts, take, v, (p) => encodeCursor(p.publishedAt!, p.id));
  }

  /** Public posts for these ids, in this order, as this viewer may see them. */
  async byIds(ids: string[], v: Viewer) {
    if (!ids.length) return [];
    const rows = await this.prisma.post.findMany({ where: { AND: [this.visibleWhere(v), { visibility: 'PUBLIC', id: { in: ids } }] }, include: POST_INCLUDE });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return this.present(ids.filter((id) => byId.has(id)).map((id) => byId.get(id)!), v);
  }

  private async page(posts: FullPost[], take: number, v: Viewer, next: (last: FullPost) => string) {
    const more = posts.length > take;
    const items = posts.slice(0, take);
    return { items: await this.present(items, v), nextCursor: more && items.length ? next(items[items.length - 1]) : null };
  }

  private async present(posts: FullPost[], v: Viewer) {
    const ids = posts.map((p) => p.id);
    const [likes, saves] = v.id && ids.length
      ? await Promise.all([
          this.prisma.postLike.findMany({ where: { userId: v.id, postId: { in: ids } }, select: { postId: true } }),
          this.prisma.postSave.findMany({ where: { userId: v.id, postId: { in: ids } }, select: { postId: true } }),
        ])
      : [[], []];
    const liked = new Set(likes.map((l) => l.postId));
    const saved = new Set(saves.map((s) => s.postId));
    return Promise.all(
      posts.map(async (p) => ({
        id: p.id,
        type: p.type,
        status: p.status,
        visibility: p.visibility,
        caption: p.caption,
        locationName: p.locationName,
        author: { id: p.author.id, name: p.author.name, avatarUrl: p.author.avatarUrl },
        pets: p.pets.map((x) => x.pet),
        hashtags: p.hashtags.map((h) => h.hashtag.tag),
        media: (await Promise.all(p.media.map((m) => this.mediaSvc.view(m.media)))) as MediaView[],
        counts: { likes: p.likeCount, comments: p.commentCount, saves: p.saveCount, shares: p.shareCount, views: p.viewCount },
        viewer: { liked: liked.has(p.id), saved: saved.has(p.id), isAuthor: v.id === p.authorId },
        publishedAt: p.publishedAt,
        createdAt: p.createdAt,
      })),
    );
  }

  // ───────────── engagement ─────────────

  private async visiblePost(id: string, v: Viewer) {
    const post = await this.prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, status: true, deletedAt: true, visibility: true, author: { select: { status: true } } } });
    if (!post || !this.canView(post, v) || post.status !== 'PUBLISHED') throw new NotFoundException('Post not found.');
    return post;
  }

  async like(v: Viewer, id: string, on: boolean) {
    await this.visiblePost(id, v);
    return this.toggle('like', v.id!, id, on);
  }

  async save(v: Viewer, id: string, on: boolean) {
    await this.visiblePost(id, v);
    return this.toggle('save', v.id!, id, on);
  }

  /** Idempotent toggle; the counter moves only when the row actually changes. */
  private async toggle(kind: 'like' | 'save', userId: string, postId: string, on: boolean) {
    const count = await this.prisma.$transaction(async (tx) => {
      const key = { userId, postId };
      let changed: number;
      if (kind === 'like') {
        changed = on ? (await tx.postLike.createMany({ data: [key], skipDuplicates: true })).count : (await tx.postLike.deleteMany({ where: key })).count;
      } else {
        changed = on ? (await tx.postSave.createMany({ data: [key], skipDuplicates: true })).count : (await tx.postSave.deleteMany({ where: key })).count;
      }
      const delta = changed ? (on ? 1 : -1) : 0;
      if (kind === 'like' && on && changed) this.queue.notify({ type: 'POST_LIKE', actorId: userId, postId });
      const p = await tx.post.update({
        where: { id: postId },
        data: kind === 'like' ? { likeCount: { increment: delta } } : { saveCount: { increment: delta } },
        select: { likeCount: true, saveCount: true },
      });
      return kind === 'like' ? p.likeCount : p.saveCount;
    });
    return { active: on, count };
  }

  async share(v: Viewer, id: string, channel?: string) {
    await this.visiblePost(id, v);
    const [, p] = await this.prisma.$transaction([
      this.prisma.postShare.create({ data: { userId: v.id!, postId: id, channel } }),
      this.prisma.post.update({ where: { id }, data: { shareCount: { increment: 1 } }, select: { shareCount: true } }),
    ]);
    return { count: p.shareCount };
  }

  /** One counted view per viewer (or IP when signed out) per post per day. */
  /**
   * A view, once per viewer per post per day. `completed`: the app played a video to its last frame (counted once
   * per viewer per day too); it feeds the reels completion rate in analytics.
   */
  async view(v: Viewer, id: string, ip?: string, completed = false) {
    await this.visiblePost(id, v);
    const who = v.id ?? `ip:${ip ?? 'unknown'}`;
    const day = new Date().toISOString().slice(0, 10);
    const fresh = await this.redis.client.set(`view:${id}:${who}:${day}`, '1', 'EX', 90_000, 'NX');
    if (fresh) {
      await this.prisma.post.update({ where: { id }, data: { viewCount: { increment: 1 } } });
      await this.activity.view(id);
    }
    const finished = completed ? await this.activity.completed(id, who) : false;
    return { counted: fresh === 'OK', completed: finished };
  }

  // ───────────── comments ─────────────

  async comments(v: Viewer, postId: string, parentId: string | null, cursorStr: string | undefined, limit: number) {
    await this.visiblePost(postId, v);
    const c = decodeCursor(cursorStr);
    const take = Math.min(limit, MAX_PAGE);
    const rows = await this.prisma.comment.findMany({
      where: {
        postId,
        parentId,
        status: 'VISIBLE',
        deletedAt: null,
        author: { status: 'ACTIVE' },
        ...(v.blocked.size ? { authorId: { notIn: [...v.blocked] } } : {}),
        ...(c ? { OR: [{ createdAt: { lt: c.date } }, { createdAt: c.date, id: { lt: c.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    const more = rows.length > take;
    const items = rows.slice(0, take).map((r) => ({
      id: r.id, body: r.body, parentId: r.parentId, replyCount: r.replyCount, author: r.author, createdAt: r.createdAt, isAuthor: r.authorId === v.id,
    }));
    return { items, nextCursor: more ? encodeCursor(rows[take - 1].createdAt, rows[take - 1].id) : null };
  }

  async addComment(v: Viewer, postId: string, dto: CommentDto) {
    const post = await this.visiblePost(postId, v);
    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await this.prisma.comment.findFirst({ where: { id: dto.parentId, postId, status: 'VISIBLE', deletedAt: null } });
      if (!parent) throw new NotFoundException('The comment you replied to no longer exists.');
      parentId = parent.parentId ?? parent.id; // one level of threading: replies to replies join the thread
    }
    const comment = await this.prisma.$transaction(async (tx) => {
      const cm = await tx.comment.create({ data: { postId, authorId: v.id!, parentId, body: dto.body }, include: { author: { select: { id: true, name: true, avatarUrl: true } } } });
      await tx.post.update({ where: { id: post.id }, data: { commentCount: { increment: 1 } } });
      if (parentId) await tx.comment.update({ where: { id: parentId }, data: { replyCount: { increment: 1 } } });
      return cm;
    });
    this.queue.assess('COMMENT', comment.id);
    this.queue.notify(
      parentId
        ? { type: 'COMMENT_REPLY', actorId: v.id!, postId, commentId: comment.id, parentId }
        : { type: 'POST_COMMENT', actorId: v.id!, postId, commentId: comment.id },
    );
    return { id: comment.id, body: comment.body, parentId: comment.parentId, replyCount: 0, author: comment.author, createdAt: comment.createdAt, isAuthor: true };
  }

  /** The comment's author or the post's author can delete it. */
  async deleteComment(userId: string, commentId: string) {
    const cm = await this.prisma.comment.findFirst({ where: { id: commentId, deletedAt: null }, include: { post: { select: { authorId: true } } } });
    if (!cm || (cm.authorId !== userId && cm.post.authorId !== userId)) throw new NotFoundException('Comment not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id: commentId }, data: { deletedAt: new Date(), status: 'REMOVED' } });
      if (cm.status === 'VISIBLE') {
        await tx.post.update({ where: { id: cm.postId }, data: { commentCount: { decrement: 1 } } });
        if (cm.parentId) await tx.comment.update({ where: { id: cm.parentId }, data: { replyCount: { decrement: 1 } } });
      }
    });
  }

  async trendingHashtags(limit = 20) {
    return this.prisma.hashtag.findMany({ where: { postCount: { gt: 0 } }, orderBy: { postCount: 'desc' }, take: Math.min(limit, 50), select: { tag: true, postCount: true } });
  }
}
