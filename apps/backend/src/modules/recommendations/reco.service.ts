import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PlatformService } from '../platform/platform.service';
import { PostsService } from '../posts/posts.service';
import { OrdersService } from '../marketplace/orders.service';
import { ContestsService } from '../contests/contests.service';
import { ChallengesService } from '../challenges/challenges.service';
import { PET_CARD_SELECT } from '../pets/pets.service';
import { encodeOffset } from '../posts/text';
import { Prisma } from '../../generated/prisma/client';
import {
  lifeStage, rankContests, rankPartners, rankProducts, rankReels,
  type Affinity, type PartnerCandidate, type PetInfo, type ProductCandidate, type ReelCandidate,
} from './reco.rules';

/** Who the recommendations are for. Signed out, or personalisation off: no pets or history are used. */
export interface Who {
  userId?: string;
  personalised: boolean;
  pets: PetInfo[];
  speciesIds: string[];
  city: string | null;
  lat?: number;
  lng?: number;
}

export type DismissTarget = 'PRODUCT' | 'PARTNER' | 'CONTEST' | 'CHALLENGE' | 'POST' | 'PET';
export const DISMISS_TARGETS: DismissTarget[] = ['PRODUCT', 'PARTNER', 'CONTEST', 'CHALLENGE', 'POST', 'PET'];

const DAY = 86_400_000;
const REEL_CACHE_TTL = 600;

/** Adds the reason and pinned flag every recommended item carries. */
export const tag = <T extends { id: string }>(items: T[], reasons: Map<string, string[]>) =>
  items.map((x) => ({ ...x, reason: reasons.get(x.id)?.[0] ?? null }));

@Injectable()
export class RecoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly platform: PlatformService,
    private readonly posts: PostsService,
    private readonly orders: OrdersService,
    private readonly contestsSvc: ContestsService,
    private readonly challengesSvc: ChallengesService,
  ) {}

  // ═════════════ who ═════════════

  async who(userId: string | undefined, loc: { lat?: number; lng?: number; city?: string } = {}): Promise<Who> {
    const global = await this.platform.getSetting<boolean>('reco.personalisationEnabled');
    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { city: true, preferences: true, addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], take: 1, select: { city: true, latitude: true, longitude: true } } },
        })
      : null;
    const personalised = !!user && global && personalisedPref(user.preferences);
    const pets = personalised
      ? (
          await this.prisma.pet.findMany({
            where: { ownerId: userId, deletedAt: null, status: 'ACTIVE' },
            select: { id: true, name: true, speciesId: true, dateOfBirth: true, species: { select: { key: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          })
        ).map((p) => ({ id: p.id, name: p.name, speciesId: p.speciesId, speciesName: p.species.name, stage: lifeStage(p.species.key, p.dateOfBirth) }))
      : [];
    const addr = user?.addresses[0];
    const hasPoint = loc.lat !== undefined && loc.lng !== undefined;
    return {
      userId,
      personalised,
      pets,
      speciesIds: [...new Set(pets.map((p) => p.speciesId))],
      city: loc.city?.trim() || addr?.city || user?.city || null,
      lat: hasPoint ? loc.lat : addr?.latitude != null ? Number(addr.latitude) : undefined,
      lng: hasPoint ? loc.lng : addr?.longitude != null ? Number(addr.longitude) : undefined,
    };
  }

  private async dismissed(who: Who, type: DismissTarget): Promise<string[]> {
    if (!who.userId) return [];
    const rows = await this.prisma.recoDismissal.findMany({ where: { userId: who.userId, targetType: type }, select: { targetId: true } });
    return rows.map((r) => r.targetId);
  }

  private async historySince() {
    return new Date(Date.now() - (await this.platform.getSetting<number>('reco.historyDays')) * DAY);
  }

  /** Category affinity from actions (weight 3 per item) and views (1 per item viewed). */
  private async affinity(
    who: Who,
    kind: 'PRODUCT_VIEW' | 'SERVICE_VIEW' | 'CONTEST_VIEW',
    acted: Array<{ categoryId: string | null; name: string | null }>,
    names: (ids: string[]) => Promise<Map<string, string>>,
  ): Promise<Map<string, Affinity>> {
    const out = new Map<string, Affinity>();
    for (const a of acted) {
      if (!a.categoryId) continue;
      const cur = out.get(a.categoryId) ?? { weight: 0, name: a.name ?? '', acted: true };
      out.set(a.categoryId, { ...cur, weight: cur.weight + 3, acted: true });
    }
    if (!who.userId) return out;
    const views = await this.prisma.interestEvent.groupBy({
      by: ['categoryId'],
      where: { userId: who.userId, kind, categoryId: { not: null }, createdAt: { gte: await this.historySince() } },
      _count: { _all: true },
    });
    const missing = views.map((v) => v.categoryId!).filter((id) => !out.has(id));
    const nameOf = missing.length ? await names(missing) : new Map<string, string>();
    for (const v of views) {
      const id = v.categoryId!;
      const cur = out.get(id) ?? { weight: 0, name: nameOf.get(id) ?? '', acted: false };
      out.set(id, { ...cur, weight: cur.weight + v._count._all });
    }
    for (const [id, a] of out) if (!a.name) out.delete(id); // category since deleted
    return out;
  }

  // ═════════════ products ═════════════

  async products(who: Who, limit: number, skip: string[] = []) {
    const out = await this.cachedProductIds(who, limit + skip.length);
    const ids = out.ids.filter((id) => !skip.includes(id)).slice(0, limit);
    return tag(await this.orders.cardsByIds(ids), out.reasons);
  }

  /**
   * The ranking is the expensive part (purchase, booking and view history), so it is kept for two minutes per person
   * (or per city and species when signed out). Prices and stock are always read fresh by cardsByIds.
   */
  private async cachedProductIds(who: Who, limit: number) {
    const key = productCacheKey(who, limit);
    const hit = await this.redis.getJson<{ ids: string[]; reasons: Array<[string, string[]]> }>(key).catch(() => null);
    if (hit) return { ids: hit.ids, reasons: new Map(hit.reasons) };
    const out = await this.productIds(who, limit);
    await this.redis.setJson(key, { ids: out.ids, reasons: [...out.reasons] }, PRODUCT_CACHE_TTL).catch(() => undefined);
    return out;
  }

  private async forgetProducts(userId: string) {
    const keys = await this.redis.client.keys(`reco:products:u:${userId}:*`).catch(() => [] as string[]);
    if (keys.length) await this.redis.client.del(...keys);
  }

  private async productIds(who: Who, limit: number) {
    const nameOf = async (ids: string[]) => new Map((await this.prisma.productCategory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    let bought: Array<{ productId: string; categoryId: string; categoryName: string; brand: string | null; at: Date }> = [];
    if (who.personalised && who.userId) {
      bought = await this.prisma.$queryRaw`
        SELECT p."id" AS "productId", p."categoryId", c."name" AS "categoryName", p."brand", MAX(o."createdAt") AS "at"
        FROM "OrderItem" i
        JOIN "SubOrder" s ON s."id" = i."subOrderId"
        JOIN "Order" o ON o."id" = s."orderId"
        JOIN "ProductVariant" v ON v."id" = i."variantId"
        JOIN "Product" p ON p."id" = v."productId"
        JOIN "ProductCategory" c ON c."id" = p."categoryId"
        WHERE o."userId" = ${who.userId}::uuid AND o."status" IN ('PAID', 'COMPLETED') AND o."createdAt" > now() - interval '365 days'
        GROUP BY 1, 2, 3, 4`;
    }
    const categories = who.personalised ? await this.affinity(who, 'PRODUCT_VIEW', bought.map((b) => ({ categoryId: b.categoryId, name: b.categoryName })), nameOf) : new Map<string, Affinity>();
    const brands = new Map<string, number>();
    for (const b of bought) if (b.brand) brands.set(b.brand.toLowerCase(), (brands.get(b.brand.toLowerCase()) ?? 0) + 1);

    const dismissed = await this.dismissed(who, 'PRODUCT');
    const rows = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE', vendor: { status: 'APPROVED' }, variants: { some: { isActive: true } },
        ...(dismissed.length ? { id: { notIn: dismissed } } : {}),
        ...(who.speciesIds.length ? { OR: [{ speciesIds: { hasSome: who.speciesIds } }, { speciesIds: { isEmpty: true } }] } : {}),
      },
      select: {
        id: true, vendorId: true, categoryId: true, title: true, brand: true, speciesIds: true,
        category: { select: { name: true } }, vendor: { select: { ratingAvg: true, ratingCount: true } }, variants: { where: { isActive: true }, select: { stock: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 400,
    });
    const sales = rows.length
      ? await this.prisma.$queryRaw<Array<{ productId: string; n: number }>>`
          SELECT v."productId", SUM(i."qty")::int AS n
          FROM "OrderItem" i JOIN "ProductVariant" v ON v."id" = i."variantId" JOIN "SubOrder" s ON s."id" = i."subOrderId"
          WHERE v."productId" = ANY(${rows.map((r) => r.id)}::uuid[]) AND s."status" NOT IN ('PENDING_PAYMENT', 'CANCELLED') AND s."createdAt" > now() - interval '30 days'
          GROUP BY 1`
      : [];
    const sold = new Map(sales.map((s) => [s.productId, s.n]));
    const cands: ProductCandidate[] = rows.map((r) => ({
      id: r.id, vendorId: r.vendorId, categoryId: r.categoryId, categoryName: r.category.name, title: r.title, brand: r.brand, speciesIds: r.speciesIds,
      sales30d: sold.get(r.id) ?? 0, vendorRating: r.vendor.ratingAvg, vendorRatingCount: r.vendor.ratingCount, inStock: r.variants.some((v) => v.stock > 0),
    }));
    const ranked = rankProducts(cands, { pets: who.pets, categories, brands, bought: new Map(bought.map((b) => [b.productId, b.at])) }).slice(0, limit);
    return { ids: ranked.map((r) => r.item.id), reasons: new Map(ranked.map((r) => [r.item.id, r.reasons])) };
  }

  // ═════════════ services ═════════════

  async partners(who: Who, limit: number, skip: string[] = []) {
    if (who.lat === undefined || who.lng === undefined) return [];
    const radiusKm = await this.platform.getSetting<number>('services.searchRadiusKm');
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${who.lng}, ${who.lat}), 4326)::geography`;
    const dismissed = [...(await this.dismissed(who, 'PARTNER')), ...skip];
    const near = await this.prisma.$queryRaw<Array<{ id: string; meters: number; ratingAvg: number; ratingCount: number }>>`
      SELECT p."id", ST_Distance(p."location", ${point}) AS meters, p."ratingAvg", p."ratingCount"
      FROM "ServicePartner" p
      WHERE p."status" = 'APPROVED' AND ST_DWithin(p."location", ${point}, ${radiusKm * 1000})
        AND EXISTS (SELECT 1 FROM "PartnerService" s WHERE s."partnerId" = p."id" AND s."isActive")
        ${dismissed.length ? Prisma.sql`AND p."id" <> ALL(${dismissed}::uuid[])` : Prisma.empty}
      ORDER BY meters ASC
      LIMIT 80`;
    if (!near.length) return [];
    const services = await this.prisma.partnerService.findMany({ where: { partnerId: { in: near.map((n) => n.id) }, isActive: true }, select: { partnerId: true, categoryId: true, speciesIds: true } });

    let booked: Array<{ partnerId: string; categoryId: string; categoryName: string; rating: number | null }> = [];
    if (who.personalised && who.userId) {
      const rows = await this.prisma.booking.findMany({
        where: { customerId: who.userId, status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] }, createdAt: { gt: new Date(Date.now() - 365 * DAY) } },
        select: { partnerId: true, createdAt: true, service: { select: { categoryId: true, category: { select: { name: true } } } }, review: { select: { rating: true } } },
        orderBy: { createdAt: 'asc' },
      });
      booked = rows.map((b) => ({ partnerId: b.partnerId, categoryId: b.service.categoryId, categoryName: b.service.category.name, rating: b.review?.rating ?? null }));
    }
    const nameOf = async (ids: string[]) => new Map((await this.prisma.serviceCategory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const categories = who.personalised ? await this.affinity(who, 'SERVICE_VIEW', booked.map((b) => ({ categoryId: b.categoryId, name: b.categoryName })), nameOf) : new Map<string, Affinity>();
    const cands: PartnerCandidate[] = near.map((n) => ({
      id: n.id, distanceKm: Math.round(n.meters / 100) / 10, ratingAvg: n.ratingAvg, ratingCount: n.ratingCount,
      services: services.filter((s) => s.partnerId === n.id).map((s) => ({ categoryId: s.categoryId, speciesIds: s.speciesIds })),
    }));
    const ranked = rankPartners(cands, { pets: who.pets, categories, bookedPartners: new Map(booked.map((b) => [b.partnerId, b.rating])) }).slice(0, limit);
    return tag(await this.partnerCards(ranked.map((r) => r.item.id), who), new Map(ranked.map((r) => [r.item.id, r.reasons])));
  }

  /** The same card as the nearby search, for these partners in this order (distance when a location is known). */
  async partnerCards(ids: string[], who: Pick<Who, 'lat' | 'lng'>) {
    if (!ids.length) return [];
    const partners = await this.prisma.servicePartner.findMany({
      where: { id: { in: ids }, status: 'APPROVED' },
      select: { id: true, slug: true, businessName: true, area: true, city: true, ratingAvg: true, ratingCount: true, homeVisitRadiusKm: true, lat: true, lng: true, services: { where: { isActive: true }, select: { pricePaise: true } } },
    });
    const byId = new Map(partners.filter((p) => p.services.length).map((p) => [p.id, p]));
    return ids.filter((id) => byId.has(id)).map((id) => {
      const { services, lat, lng, ...p } = byId.get(id)!;
      return {
        ...p,
        distanceKm: who.lat !== undefined && who.lng !== undefined ? Math.round(haversineKm(who.lat, who.lng, lat, lng) * 10) / 10 : null,
        fromPaise: Math.min(...services.map((s) => s.pricePaise)),
      };
    });
  }

  // ═════════════ contests ═════════════

  async contests(who: Who, limit: number, skip: string[] = []) {
    const now = new Date();
    const dismissed = [...(await this.dismissed(who, 'CONTEST')), ...skip];
    const open = await this.prisma.contest.findMany({
      where: { status: { in: ['SCHEDULED', 'LIVE'] }, registrationOpensAt: { lte: now }, registrationClosesAt: { gt: now }, ...(dismissed.length ? { id: { notIn: dismissed } } : {}) },
      select: { id: true, categoryId: true, eligibleSpeciesIds: true, feePaise: true, registrationClosesAt: true, maxParticipants: true, _count: { select: { participants: { where: { status: { in: ['REGISTERED', 'SUBMITTED', 'QUALIFIED', 'FINALIST', 'WINNER'] } } } } } },
      take: 100,
    });
    let entries: Array<{ contestId: string; petId: string; categoryId: string | null; categoryName: string | null }> = [];
    if (who.userId) {
      const rows = await this.prisma.contestParticipant.findMany({
        where: { userId: who.userId, status: { notIn: ['WITHDRAWN', 'PENDING_PAYMENT'] } },
        select: { contestId: true, petId: true, contest: { select: { categoryId: true, category: { select: { name: true } } } } },
      });
      entries = rows.map((r) => ({ contestId: r.contestId, petId: r.petId, categoryId: r.contest.categoryId, categoryName: r.contest.category?.name ?? null }));
    }
    const nameOf = async (ids: string[]) => new Map((await this.prisma.contestCategory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const categories = who.personalised ? await this.affinity(who, 'CONTEST_VIEW', entries.map((e) => ({ categoryId: e.categoryId, name: e.categoryName })), nameOf) : new Map<string, Affinity>();
    const entered = new Map<string, Set<string>>();
    for (const e of entries) entered.set(e.contestId, (entered.get(e.contestId) ?? new Set()).add(e.petId));
    const ranked = rankContests(
      open.map((c) => ({ id: c.id, categoryId: c.categoryId, eligibleSpeciesIds: c.eligibleSpeciesIds, feePaise: c.feePaise, registrationClosesAt: c.registrationClosesAt, entries: c._count.participants, maxParticipants: c.maxParticipants })),
      { pets: who.pets, categories, entered },
    ).slice(0, limit);
    const reasons = new Map(ranked.map((r) => [r.item.id, r.reasons]));
    const ids = ranked.map((r) => r.item.id);
    if (ids.length < limit) {
      // Then contests people can vote in now.
      const voting = await this.prisma.contest.findMany({
        where: { status: 'VOTING', votingClosesAt: { gt: now }, id: { notIn: [...ids, ...dismissed] } },
        orderBy: { votingClosesAt: 'asc' }, take: limit - ids.length, select: { id: true },
      });
      for (const v of voting) {
        ids.push(v.id);
        reasons.set(v.id, ['Voting is open']);
      }
    }
    return tag(await this.contestsSvc.cardsByIds(ids), reasons);
  }

  // ═════════════ challenges ═════════════

  async challenges(who: Who, limit: number, skip: string[] = []) {
    const now = new Date();
    const dismissed = [...(await this.dismissed(who, 'CHALLENGE')), ...skip];
    const rows = await this.prisma.challenge.findMany({
      where: { status: 'PUBLISHED', endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + 30 * DAY) }, ...(dismissed.length ? { id: { notIn: dismissed } } : {}) },
      select: { id: true },
      orderBy: { startsAt: 'asc' },
      take: 60,
    });
    const cards = await this.challengesSvc.cardsByIds(rows.map((r) => r.id), who.userId);
    const rank = (c: (typeof cards)[number]) =>
      c.mine?.status === 'ACTIVE' && !c.mine.checkedInToday && c.startsAt <= now ? 0 : c.mine ? 3 : c.startsAt <= now ? 1 : 2;
    const sorted = [...cards].sort((a, b) => rank(a) - rank(b) || b.participants - a.participants || a.startsAt.getTime() - b.startsAt.getTime());
    const reasons = new Map<string, string[]>();
    for (const c of sorted) {
      const days = Math.ceil((c.startsAt.getTime() - now.getTime()) / DAY);
      const r = rank(c) === 0 ? 'Check in today' : c.startsAt > now ? (days <= 1 ? 'Starts tomorrow' : `Starts in ${days} days`) : c.participants >= 10 ? `${c.participants} taking part` : null;
      if (r) reasons.set(c.id, [r]);
    }
    return tag(sorted.slice(0, limit), reasons);
  }

  // ═════════════ reels ═════════════

  async reels(who: Who, offset: number, limit: number) {
    const key = `reco:reels:${who.userId ?? 'anon'}:${who.personalised ? 1 : 0}`;
    let ranked = offset > 0 ? await this.redis.getJson<Array<{ id: string; r: string | null }>>(key) : null;
    if (!ranked) {
      ranked = await this.rankReelIds(who);
      await this.redis.setJson(key, ranked, REEL_CACHE_TTL);
    }
    const page = ranked.slice(offset, offset + limit);
    const viewer = await this.posts.viewer(who.userId);
    const items = await this.posts.byIds(page.map((p) => p.id), viewer);
    const reasons = new Map(page.map((p) => [p.id, p.r ? [p.r] : []]));
    return { items: tag(items, reasons), nextCursor: offset + limit < ranked.length ? encodeOffset(offset + limit) : null };
  }

  /** Ranked reel ids (and each one's reason), for paging. */
  async rankReelIds(who: Who, limit = 400): Promise<Array<{ id: string; r: string | null }>> {
    const viewer = await this.posts.viewer(who.userId);
    const dismissed = await this.dismissed(who, 'POST');
    const rows = await this.prisma.post.findMany({
      where: {
        type: 'REEL', status: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null, author: { status: 'ACTIVE' },
        publishedAt: { gt: new Date(Date.now() - 30 * DAY) },
        authorId: { notIn: [...viewer.blocked] },
        ...(dismissed.length ? { id: { notIn: dismissed } } : {}),
      },
      select: { id: true, authorId: true, score: true, publishedAt: true, pets: { select: { petId: true, pet: { select: { speciesId: true } } } }, hashtags: { select: { hashtag: { select: { tag: true } } } } },
      orderBy: [{ score: 'desc' }, { publishedAt: 'desc' }],
      take: limit,
    });
    const s = {
      viewerId: who.userId ?? null,
      followedUsers: new Set<string>(),
      followedPets: new Set<string>(),
      petSpecies: new Map(who.pets.map((p) => [p.speciesId, p.speciesName])),
      likedAuthors: new Map<string, number>(),
      hashtags: new Map<string, number>(),
    };
    if (who.personalised && who.userId) {
      const since = new Date(Date.now() - 60 * DAY);
      const [pets, likes, saves] = await Promise.all([
        this.prisma.petFollower.findMany({ where: { userId: who.userId }, select: { petId: true } }),
        this.prisma.postLike.findMany({ where: { userId: who.userId, createdAt: { gt: since } }, select: { post: { select: { authorId: true, hashtags: { select: { hashtag: { select: { tag: true } } } } } } }, take: 300, orderBy: { createdAt: 'desc' } }),
        this.prisma.postSave.findMany({ where: { userId: who.userId, createdAt: { gt: since } }, select: { post: { select: { authorId: true, hashtags: { select: { hashtag: { select: { tag: true } } } } } } }, take: 300, orderBy: { createdAt: 'desc' } }),
      ]);
      s.followedUsers = viewer.following;
      s.followedPets = new Set(pets.map((p) => p.petId));
      for (const { post } of [...likes, ...saves]) {
        s.likedAuthors.set(post.authorId, (s.likedAuthors.get(post.authorId) ?? 0) + 1);
        for (const h of post.hashtags) s.hashtags.set(h.hashtag.tag, (s.hashtags.get(h.hashtag.tag) ?? 0) + 1);
      }
    }
    const cands: ReelCandidate[] = rows.map((r) => ({
      id: r.id, authorId: r.authorId, petIds: r.pets.map((p) => p.petId), speciesIds: [...new Set(r.pets.map((p) => p.pet.speciesId))],
      hashtags: r.hashtags.map((h) => h.hashtag.tag), trending: r.score, publishedAt: r.publishedAt ?? new Date(0),
    }));
    return rankReels(cands, s).map((r) => ({ id: r.item.id, r: r.reasons[0] ?? null }));
  }

  // ═════════════ pets ═════════════

  /** Pets gaining followers and engagement this week (shared list, cached for 5 minutes). */
  async trendingPets(who: Who, limit: number, skip: string[] = []) {
    const key = 'reco:pets:trending';
    let list = await this.redis.getJson<Array<{ id: string; ownerId: string; followers: number }>>(key);
    if (!list) {
      list = await this.prisma.$queryRaw<Array<{ id: string; ownerId: string; followers: number }>>`
        SELECT p."id", p."ownerId", COALESCE(f.n, 0)::int AS followers
        FROM "Pet" p
        JOIN "User" u ON u."id" = p."ownerId" AND u."status" = 'ACTIVE'
        LEFT JOIN (SELECT "petId", COUNT(*) AS n FROM "PetFollower" WHERE "createdAt" > now() - interval '7 days' GROUP BY 1) f ON f."petId" = p."id"
        LEFT JOIN (
          SELECT pp."petId", SUM(po."likeCount" + 2 * po."commentCount" + 2 * po."saveCount") AS n
          FROM "PostPet" pp JOIN "Post" po ON po."id" = pp."postId"
          WHERE po."status" = 'PUBLISHED' AND po."visibility" = 'PUBLIC' AND po."deletedAt" IS NULL AND po."publishedAt" > now() - interval '7 days'
          GROUP BY 1
        ) e ON e."petId" = p."id"
        WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE' AND p."visibility" = 'PUBLIC'
        ORDER BY (COALESCE(f.n, 0) * 3 + COALESCE(e.n, 0)) DESC, p."followerCount" DESC, p."id"
        LIMIT 60`;
      await this.redis.setJson(key, list, 300);
    }
    const viewer = await this.posts.viewer(who.userId);
    const dismissed = new Set([...(await this.dismissed(who, 'PET')), ...skip]);
    const picked = list.filter((p) => p.ownerId !== who.userId && !viewer.blocked.has(p.ownerId) && !dismissed.has(p.id)).slice(0, limit);
    const cards = await this.petCards(picked.map((p) => p.id));
    const reasons = new Map(picked.filter((p) => p.followers > 0).map((p) => [p.id, [`${p.followers} new follower${p.followers === 1 ? '' : 's'} this week`]]));
    return tag(cards, reasons);
  }

  async petCards(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.pet.findMany({ where: { id: { in: ids }, deletedAt: null, status: 'ACTIVE', visibility: 'PUBLIC' }, select: PET_CARD_SELECT });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  }

  // ═════════════ coming up ═════════════

  /** The person's next bookings and contest deadlines, then contests and challenges starting soon. */
  async upcoming(who: Who, limit: number, on: { contests: boolean; services: boolean }) {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * DAY);
    type Item = { id: string; kind: 'BOOKING' | 'CONTEST' | 'CHALLENGE'; title: string; subtitle: string | null; label: string; at: Date; imageUrl: string | null; mine: boolean };
    const items: Item[] = [];
    if (who.userId && on.services) {
      const bookings = await this.prisma.booking.findMany({
        where: { customerId: who.userId, status: 'CONFIRMED', startsAt: { gt: now, lt: new Date(now.getTime() + 14 * DAY) } },
        select: { id: true, startsAt: true, service: { select: { name: true } }, partner: { select: { businessName: true } }, pet: { select: { name: true } } },
        orderBy: { startsAt: 'asc' }, take: 5,
      });
      for (const b of bookings) items.push({ id: b.id, kind: 'BOOKING', title: `${b.service.name} at ${b.partner.businessName}`, subtitle: b.pet.name, label: 'Your booking', at: b.startsAt, imageUrl: null, mine: true });
    }
    if (on.contests) {
      if (who.userId) {
        const mine = await this.prisma.contestParticipant.findMany({
          where: { userId: who.userId, status: { in: ['REGISTERED', 'SUBMITTED', 'QUALIFIED', 'FINALIST'] }, contest: { status: { in: ['SCHEDULED', 'LIVE', 'VOTING'] } } },
          select: { pet: { select: { name: true } }, contest: { select: { id: true, title: true, bannerUrl: true, status: true, submissionClosesAt: true, votingClosesAt: true } } },
          take: 10,
        });
        const seen = new Set<string>();
        for (const m of mine) {
          const c = m.contest;
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          const [label, at] = c.status !== 'VOTING' && c.submissionClosesAt > now ? ['Entries due', c.submissionClosesAt] : ['Voting closes', c.votingClosesAt];
          if (at > now) items.push({ id: c.id, kind: 'CONTEST', title: c.title, subtitle: m.pet.name, label, at, imageUrl: c.bannerUrl, mine: true });
        }
      }
      const opening = await this.prisma.contest.findMany({
        where: { status: { in: ['SCHEDULED', 'LIVE'] }, registrationOpensAt: { gt: now, lt: soon } },
        select: { id: true, title: true, bannerUrl: true, registrationOpensAt: true }, orderBy: { registrationOpensAt: 'asc' }, take: limit,
      });
      for (const c of opening) items.push({ id: c.id, kind: 'CONTEST', title: c.title, subtitle: null, label: 'Entries open', at: c.registrationOpensAt, imageUrl: c.bannerUrl, mine: false });
      const starting = await this.prisma.challenge.findMany({
        where: { status: 'PUBLISHED', startsAt: { gt: now, lt: soon } },
        select: { id: true, title: true, bannerUrl: true, startsAt: true }, orderBy: { startsAt: 'asc' }, take: limit,
      });
      for (const c of starting) items.push({ id: c.id, kind: 'CHALLENGE', title: c.title, subtitle: null, label: 'Starts', at: c.startsAt, imageUrl: c.bannerUrl, mine: false });
    }
    // Their own plans first, then everything by date.
    return items.sort((a, b) => Number(b.mine) - Number(a.mine) || a.at.getTime() - b.at.getTime()).slice(0, limit).map(({ mine: _m, ...x }) => ({ ...x, reason: null }));
  }

  // ═════════════ offers ═════════════

  /** Coupons admins picked for the home screen that can be used right now. */
  async offers(couponIds: string[]) {
    if (!couponIds.length) return [];
    const now = new Date();
    const rows = await this.prisma.coupon.findMany({
      where: { id: { in: couponIds }, isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
      include: { vendor: { select: { id: true, businessName: true, slug: true, status: true } } },
    });
    const byId = new Map(rows.filter((c) => (c.usageLimit === null || c.usedCount < c.usageLimit) && (!c.vendor || c.vendor.status === 'APPROVED')).map((c) => [c.id, c]));
    return couponIds.filter((id) => byId.has(id)).map((id) => {
      const c = byId.get(id)!;
      return {
        id: c.id, code: c.code, description: c.description, kind: c.kind, value: c.value, maxDiscountPaise: c.maxDiscountPaise, minOrderPaise: c.minOrderPaise, endsAt: c.endsAt,
        vendor: c.vendor ? { id: c.vendor.id, businessName: c.vendor.businessName, slug: c.vendor.slug } : null,
        reason: null,
      };
    });
  }

  // ═════════════ the person's settings ═════════════

  async dismiss(userId: string, targetType: DismissTarget, targetId: string) {
    await this.prisma.recoDismissal.upsert({ where: { userId_targetType_targetId: { userId, targetType, targetId } }, update: {}, create: { userId, targetType, targetId } });
    if (targetType === 'POST') await this.redis.client.del(`reco:reels:${userId}:1`, `reco:reels:${userId}:0`);
    if (targetType === 'PRODUCT') await this.forgetProducts(userId);
  }

  async settings(userId: string) {
    const [who, global, views, dismissed] = await Promise.all([
      this.who(userId),
      this.platform.getSetting<boolean>('reco.personalisationEnabled'),
      this.prisma.interestEvent.count({ where: { userId } }),
      this.prisma.recoDismissal.count({ where: { userId } }),
    ]);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } });
    return {
      personalised: personalisedPref(user.preferences),
      availableOnPlatform: global,
      historyDays: await this.platform.getSetting<number>('reco.historyDays'),
      basedOn: who.personalised
        ? ['Your pets: their species and age', 'What you buy, book and enter', 'Pets and people you follow, and posts you like or save', 'What you look at in the shop, services and contests']
        : [],
      viewsKept: views,
      hiddenItems: dismissed,
    };
  }

  async setPersonalised(userId: string, on: boolean) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } });
    const prefs = (u.preferences && typeof u.preferences === 'object' && !Array.isArray(u.preferences) ? u.preferences : {}) as Record<string, unknown>;
    await this.prisma.user.update({ where: { id: userId }, data: { preferences: { ...prefs, personalised: on } as Prisma.InputJsonValue } });
    if (!on) await this.prisma.interestEvent.deleteMany({ where: { userId } }); // turning it off also forgets what they viewed
    await this.redis.client.del(`reco:reels:${userId}:1`, `reco:reels:${userId}:0`);
    await this.forgetProducts(userId);
    return this.settings(userId);
  }

  async clearHistory(userId: string) {
    await this.prisma.$transaction([this.prisma.interestEvent.deleteMany({ where: { userId } }), this.prisma.recoDismissal.deleteMany({ where: { userId } })]);
    await this.redis.client.del(`reco:reels:${userId}:1`, `reco:reels:${userId}:0`);
    await this.forgetProducts(userId);
    return this.settings(userId);
  }
}

export const PRODUCT_CACHE_TTL = 120;

/** Per person when signed in (and personalised); otherwise shared by everyone with the same pets' species. */
export function productCacheKey(who: Pick<Who, 'userId' | 'personalised' | 'speciesIds'>, limit: number): string {
  if (who.userId) return `reco:products:u:${who.userId}:${who.personalised ? 1 : 0}:${limit}`;
  return `reco:products:anon:${[...who.speciesIds].sort().join(',') || 'any'}:${limit}`;
}

export const personalisedPref = (prefs: unknown) =>
  !(prefs && typeof prefs === 'object' && !Array.isArray(prefs) && (prefs as Record<string, unknown>).personalised === false);

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
