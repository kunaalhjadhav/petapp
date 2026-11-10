import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import { PostsService } from '../posts/posts.service';
import { OrdersService } from '../marketplace/orders.service';
import { MediaService } from '../media/media.service';
import { Paged } from '../../common/dto/pagination.dto';
import { likeText } from '../../common/utils/search';
import { Prisma } from '../../generated/prisma/client';
import type { FeatureFlagKey } from '@petapp/types';
import type { SearchQuery } from './search.dto';
import { cleanQuery, distanceText, SEARCH_TYPES, type SearchHit, type SearchType } from './search.rules';

const FLAG: Partial<Record<SearchType, FeatureFlagKey>> = {
  reels: 'ENABLE_REELS', products: 'ENABLE_MARKETPLACE', services: 'ENABLE_SERVICES', partners: 'ENABLE_SERVICES', contests: 'ENABLE_CONTESTS', challenges: 'ENABLE_CONTESTS',
};
const CONTEST_WHEN: Record<string, string[]> = {
  open: ['SCHEDULED', 'LIVE'],
  voting: ['VOTING'],
  past: ['EVALUATION', 'WINNER_DECLARATION', 'COMPLETED'],
};
const CONTEST_PUBLIC = ['SCHEDULED', 'LIVE', 'VOTING', 'EVALUATION', 'WINNER_DECLARATION', 'COMPLETED'];
const CONTEST_LABEL: Record<string, string> = {
  SCHEDULED: 'Open for entries', LIVE: 'Open for entries', VOTING: 'Voting', EVALUATION: 'Judging', WINNER_DECLARATION: 'Results', COMPLETED: 'Finished',
};

interface Pattern {
  exact: string;
  prefix: string;
  word: string;
  contains: string;
}
const patterns = (q: string): Pattern => {
  const e = likeText(q);
  return { exact: e, prefix: `${e}%`, word: `% ${e}%`, contains: `%${e}%` };
};
/** 0 exact, 1 starts with, 2 a word starts with, 3 contains (as matchRank in search.rules). */
const rank = (col: Prisma.Sql, p: Pattern) =>
  Prisma.sql`(CASE WHEN ${col} ILIKE ${p.exact} THEN 0 WHEN ${col} ILIKE ${p.prefix} THEN 1 WHEN ${col} ILIKE ${p.word} THEN 2 ELSE 3 END)`;

type Viewer = { userId?: string; blocked: string[] };

/**
 * Global search (spec §43): pets, people, reels, products, services, service businesses, contests and
 * challenges. Only public things are found: public pets, published public reels, listed products, approved
 * businesses, contests and challenges people can see. People the viewer blocked (or who blocked them) and their
 * pets and reels never appear. Each kind has its own filters.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly posts: PostsService,
    private readonly orders: OrdersService,
    private readonly media: MediaService,
  ) {}

  private async enabledTypes(): Promise<SearchType[]> {
    const flags = await this.platform.flags();
    return SEARCH_TYPES.filter((t) => !FLAG[t] || flags[FLAG[t]!]);
  }

  private async viewer(userId?: string): Promise<Viewer> {
    const v = await this.posts.viewer(userId);
    return { userId, blocked: [...v.blocked] };
  }

  /** The "All" tab: the best few of each kind. */
  async all(rawQ: string | undefined, userId?: string, q: Partial<SearchQuery> = {}) {
    const query = cleanQuery(rawQ);
    const types = await this.enabledTypes();
    if (!query) return { query: rawQ ?? '', groups: [] };
    const n = await this.platform.getSetting<number>('search.resultsPerType');
    const viewer = await this.viewer(userId);
    // Hashtags look for reels first; @handles look for pets and people.
    const order: SearchType[] = query.hashtag ? ['reels', ...types.filter((t) => t !== 'reels')] : query.handle ? ['pets', 'users', ...types.filter((t) => t !== 'pets' && t !== 'users')] : types;
    const groups = await Promise.all(
      order.filter((t) => types.includes(t)).map(async (type) => {
        const { items } = await this.run(type, query.text, viewer, { lat: q.lat, lng: q.lng }, n + 1, 0);
        return { type, items: items.slice(0, n), more: items.length > n };
      }),
    );
    return { query: query.text, groups: groups.filter((g) => g.items.length) };
  }

  /** One kind, paged, with its filters. */
  async one(type: SearchType, q: SearchQuery, userId?: string) {
    if (!(await this.enabledTypes()).includes(type)) throw new NotFoundException('This kind of search isn’t available.');
    const query = cleanQuery(q.q);
    if (!query) return Paged.of([], 0, q);
    const { items, total } = await this.run(type, query.text, await this.viewer(userId), q, q.limit, q.skip, true);
    return Paged.of(items, total, q);
  }

  /** The filters each kind offers, with their choices. */
  async filters() {
    const types = await this.enabledTypes();
    const [species, productCats, serviceCats, contestCats] = await Promise.all([
      this.prisma.petSpecies.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }),
      types.includes('products') ? this.prisma.productCategory.findMany({ where: { isActive: true, parentId: null }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }) : [],
      types.includes('services') ? this.prisma.serviceCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }) : [],
      types.includes('contests') ? this.prisma.contestCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }) : [],
    ]);
    return {
      types,
      pets: { species, city: true },
      users: { city: true },
      reels: {},
      products: { categories: productCats, species, inStock: true },
      services: { categories: serviceCats, modes: [{ id: 'AT_CENTER', name: 'At the centre' }, { id: 'AT_HOME', name: 'Home visit' }], near: true },
      partners: { categories: serviceCats, city: true, near: true },
      contests: { categories: contestCats, when: [{ id: 'open', name: 'Open for entries' }, { id: 'voting', name: 'Voting' }, { id: 'past', name: 'Finished' }] },
      challenges: { when: [{ id: 'active', name: 'On now' }, { id: 'upcoming', name: 'Starting soon' }, { id: 'past', name: 'Finished' }] },
    };
  }

  // ══════════════ per kind ══════════════

  private async run(type: SearchType, text: string, v: Viewer, f: Partial<SearchQuery>, limit: number, skip: number, count = false): Promise<{ items: SearchHit[]; total: number }> {
    const p = patterns(text);
    switch (type) {
      case 'pets': return this.pets(p, v, f, limit, skip, count);
      case 'users': return this.users(p, v, f, limit, skip, count);
      case 'reels': return this.reels(p, text, v, limit, skip, count);
      case 'products': return this.products(p, f, limit, skip, count);
      case 'services': return this.services(p, f, limit, skip, count);
      case 'partners': return this.partners(p, f, limit, skip, count);
      case 'contests': return this.contests(p, f, limit, skip, count);
      case 'challenges': return this.challenges(p, f, limit, skip, count);
    }
  }

  private async page(base: Prisma.Sql, where: Prisma.Sql, order: Prisma.Sql, limit: number, skip: number, count: boolean, select = Prisma.sql`x."id"`) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; meters?: number | null }>>`SELECT ${select} ${base} WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${skip}`;
    const total = count ? (await this.prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n ${base} WHERE ${where}`)[0].n : rows.length;
    return { rows, total };
  }

  private blockedSql(col: Prisma.Sql, v: Viewer) {
    return v.blocked.length ? Prisma.sql`AND ${col} <> ALL(${v.blocked}::uuid[])` : Prisma.empty;
  }

  private async pets(p: Pattern, v: Viewer, f: Partial<SearchQuery>, limit: number, skip: number, count: boolean) {
    const base = Prisma.sql`FROM "Pet" x JOIN "User" u ON u."id" = x."ownerId" AND u."status" = 'ACTIVE'`;
    const where = Prisma.sql`x."deletedAt" IS NULL AND x."status" = 'ACTIVE' AND x."visibility" = 'PUBLIC'
      AND (x."name" ILIKE ${p.contains} OR x."handle" ILIKE ${p.contains})
      ${f.speciesId ? Prisma.sql`AND x."speciesId" = ${f.speciesId}::uuid` : Prisma.empty}
      ${f.breedId ? Prisma.sql`AND x."breedId" = ${f.breedId}::uuid` : Prisma.empty}
      ${f.city ? Prisma.sql`AND x."city" ILIKE ${likeText(f.city)}` : Prisma.empty}
      ${this.blockedSql(Prisma.sql`x."ownerId"`, v)}`;
    const order = Prisma.sql`LEAST(${rank(Prisma.sql`x."name"`, p)}, ${rank(Prisma.sql`x."handle"`, p)}), x."followerCount" DESC, x."id"`;
    const { rows, total } = await this.page(base, where, order, limit, skip, count);
    const pets = await this.prisma.pet.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, name: true, handle: true, avatarUrl: true, city: true, isVerified: true, followerCount: true, species: { select: { name: true } }, breed: { select: { name: true } } } });
    const by = new Map(pets.map((x) => [x.id, x]));
    return {
      total,
      items: rows.map((r) => by.get(r.id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({
        type: 'PET' as const, id: x.id, title: x.name, subtitle: [`@${x.handle}`, x.breed?.name ?? x.species.name, x.city].filter(Boolean).join(' · '),
        imageUrl: x.avatarUrl, link: { kind: 'pet' as const, key: x.handle }, meta: { followers: x.followerCount, verified: x.isVerified, species: x.species.name },
      })),
    };
  }

  private async users(p: Pattern, v: Viewer, f: Partial<SearchQuery>, limit: number, skip: number, count: boolean) {
    const base = Prisma.sql`FROM "User" x`;
    // Customers only: staff accounts and accounts without a name never appear. Only the name, photo and city show.
    const where = Prisma.sql`x."status" = 'ACTIVE' AND x."deletedAt" IS NULL AND x."name" IS NOT NULL AND x."name" ILIKE ${p.contains}
      AND NOT EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId" WHERE ur."userId" = x."id" AND r."isStaff")
      ${f.city ? Prisma.sql`AND x."city" ILIKE ${likeText(f.city)}` : Prisma.empty}
      ${v.userId ? Prisma.sql`AND x."id" <> ${v.userId}::uuid` : Prisma.empty}
      ${this.blockedSql(Prisma.sql`x."id"`, v)}`;
    const order = Prisma.sql`${rank(Prisma.sql`x."name"`, p)}, (SELECT COUNT(*) FROM "UserFollower" uf WHERE uf."followingId" = x."id") DESC, x."id"`;
    const { rows, total } = await this.page(base, where, order, limit, skip, count);
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, name: true, avatarUrl: true, city: true, _count: { select: { followers: true, pets: { where: { deletedAt: null, status: 'ACTIVE', visibility: 'PUBLIC' } } } } },
    });
    const by = new Map(users.map((x) => [x.id, x]));
    return {
      total,
      items: rows.map((r) => by.get(r.id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({
        type: 'USER' as const, id: x.id, title: x.name ?? '', subtitle: [x.city, x._count.pets ? `${x._count.pets} pet${x._count.pets === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || null,
        imageUrl: x.avatarUrl, link: { kind: 'user' as const, key: x.id }, meta: { followers: x._count.followers, pets: x._count.pets },
      })),
    };
  }

  private async reels(p: Pattern, text: string, v: Viewer, limit: number, skip: number, count: boolean) {
    const tag = text.toLowerCase().replace(/\s+/g, '');
    const base = Prisma.sql`FROM "Post" x JOIN "User" u ON u."id" = x."authorId" AND u."status" = 'ACTIVE'`;
    const where = Prisma.sql`x."type" = 'REEL' AND x."status" = 'PUBLISHED' AND x."visibility" = 'PUBLIC' AND x."deletedAt" IS NULL
      AND (x."caption" ILIKE ${p.contains} OR EXISTS (SELECT 1 FROM "PostHashtag" ph JOIN "Hashtag" h ON h."id" = ph."hashtagId" WHERE ph."postId" = x."id" AND h."tag" = ${tag}))
      ${this.blockedSql(Prisma.sql`x."authorId"`, v)}`;
    const order = Prisma.sql`x."score" DESC, x."publishedAt" DESC, x."id"`;
    const { rows, total } = await this.page(base, where, order, limit, skip, count);
    const posts = await this.prisma.post.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, caption: true, likeCount: true, commentCount: true, author: { select: { name: true } }, pets: { take: 1, select: { pet: { select: { name: true } } } }, media: { orderBy: { position: 'asc' }, take: 1, include: { media: true } } },
    });
    const by = new Map(posts.map((x) => [x.id, x]));
    const items: SearchHit[] = [];
    for (const r of rows) {
      const x = by.get(r.id);
      if (!x) continue;
      const m = x.media[0]?.media;
      const view = m ? await this.media.view(m) : null;
      const who = x.pets[0]?.pet.name ?? x.author.name ?? 'PetApp';
      items.push({
        type: 'REEL', id: x.id, title: x.caption ? clip(x.caption, 80) : `Reel of ${who}`, subtitle: `${who} · ${x.likeCount} like${x.likeCount === 1 ? '' : 's'}`,
        imageUrl: view?.poster ?? view?.images?.[0]?.url ?? null, link: { kind: 'reel', key: x.id }, meta: { likes: x.likeCount, comments: x.commentCount, durationMs: view?.durationMs ?? null },
      });
    }
    return { total, items };
  }

  private async products(p: Pattern, f: Partial<SearchQuery>, limit: number, skip: number, count: boolean) {
    const base = Prisma.sql`FROM "Product" x JOIN "Vendor" vd ON vd."id" = x."vendorId" AND vd."status" = 'APPROVED'`;
    const where = Prisma.sql`x."status" = 'ACTIVE' AND EXISTS (SELECT 1 FROM "ProductVariant" pv WHERE pv."productId" = x."id" AND pv."isActive"${f.inStock ? Prisma.sql` AND pv."stock" > 0` : Prisma.empty})
      AND (x."title" ILIKE ${p.contains} OR x."brand" ILIKE ${p.contains})
      ${f.categoryId ? Prisma.sql`AND (x."categoryId" = ${f.categoryId}::uuid OR x."categoryId" IN (SELECT "id" FROM "ProductCategory" WHERE "parentId" = ${f.categoryId}::uuid))` : Prisma.empty}
      ${f.speciesId ? Prisma.sql`AND (${f.speciesId} = ANY(x."speciesIds") OR cardinality(x."speciesIds") = 0)` : Prisma.empty}`;
    const order = Prisma.sql`${rank(Prisma.sql`x."title"`, p)}, x."ratingCount" DESC, x."updatedAt" DESC, x."id"`;
    const { rows, total } = await this.page(base, where, order, limit, skip, count);
    const cards = await this.orders.cardsByIds(rows.map((r) => r.id));
    return {
      total,
      items: cards.map((c) => ({
        type: 'PRODUCT' as const, id: c.id, title: c.title, subtitle: [c.brand, c.vendor.businessName].filter(Boolean).join(' · '),
        imageUrl: c.image?.images?.find((i) => i.width >= 320)?.url ?? c.image?.images?.[0]?.url ?? null, link: { kind: 'product' as const, key: c.slug },
        meta: { fromPaise: c.fromPaise, mrpPaise: c.mrpPaise, inStock: c.inStock, ratingAvg: c.ratingAvg, ratingCount: c.ratingCount },
      })),
    };
  }

  private near(f: Partial<SearchQuery>, col: Prisma.Sql, radiusKm: number) {
    if (f.lat === undefined || f.lng === undefined) return { cond: Prisma.empty, dist: Prisma.sql`NULL::float8`, order: Prisma.empty };
    const at = Prisma.sql`ST_SetSRID(ST_MakePoint(${f.lng}, ${f.lat}), 4326)::geography`;
    return { cond: Prisma.sql`AND ST_DWithin(${col}, ${at}, ${(f.radiusKm ?? radiusKm) * 1000})`, dist: Prisma.sql`ST_Distance(${col}, ${at})`, order: Prisma.sql`ST_Distance(${col}, ${at}),` };
  }

  private async services(p: Pattern, f: Partial<SearchQuery>, limit: number, skip: number, count: boolean) {
    const radius = await this.platform.getSetting<number>('services.searchRadiusKm');
    const n = this.near(f, Prisma.sql`sp."location"`, radius);
    const base = Prisma.sql`FROM "PartnerService" x JOIN "ServicePartner" sp ON sp."id" = x."partnerId" AND sp."status" = 'APPROVED' JOIN "ServiceCategory" sc ON sc."id" = x."categoryId"`;
    const where = Prisma.sql`x."isActive" AND (x."name" ILIKE ${p.contains} OR sc."name" ILIKE ${p.contains})
      ${f.categoryId ? Prisma.sql`AND x."categoryId" = ${f.categoryId}::uuid` : Prisma.empty}
      ${f.mode ? Prisma.sql`AND ${f.mode}::"ServiceMode" = ANY(x."modes")` : Prisma.empty}
      ${f.city ? Prisma.sql`AND sp."city" ILIKE ${likeText(f.city)}` : Prisma.empty}
      ${n.cond}`;
    const order = Prisma.sql`${rank(Prisma.sql`x."name"`, p)}, ${n.order} sp."ratingAvg" DESC, x."pricePaise", x."id"`;
    const { rows, total } = await this.page(base, where, order, limit, skip, count, Prisma.sql`x."id", ${n.dist} AS meters`);
    const services = await this.prisma.partnerService.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, name: true, pricePaise: true, durationMin: true, modes: true, category: { select: { name: true } }, partner: { select: { id: true, slug: true, businessName: true, area: true, city: true, ratingAvg: true, ratingCount: true } } },
    });
    const by = new Map(services.map((x) => [x.id, x]));
    return {
      total,
      items: rows.map((r) => ({ r, x: by.get(r.id) })).filter((o): o is { r: typeof o.r; x: NonNullable<typeof o.x> } => !!o.x).map(({ r, x }) => ({
        type: 'SERVICE' as const, id: x.id, title: x.name, subtitle: [x.partner.businessName, [x.partner.area, x.partner.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
        imageUrl: null, link: { kind: 'service' as const, key: x.partner.slug },
        meta: {
          pricePaise: x.pricePaise, durationMin: x.durationMin, category: x.category.name, homeVisit: x.modes.includes('AT_HOME'), partnerId: x.partner.id,
          ratingAvg: x.partner.ratingAvg, ratingCount: x.partner.ratingCount, distance: distanceText(r.meters ?? null),
        },
      })),
    };
  }

  private async partners(p: Pattern, f: Partial<SearchQuery>, limit: number, skip: number, count: boolean) {
    const radius = await this.platform.getSetting<number>('services.searchRadiusKm');
    const n = this.near(f, Prisma.sql`x."location"`, radius);
    const base = Prisma.sql`FROM "ServicePartner" x`;
    const where = Prisma.sql`x."status" = 'APPROVED' AND (x."businessName" ILIKE ${p.contains} OR x."area" ILIKE ${p.contains})
      ${f.categoryId ? Prisma.sql`AND EXISTS (SELECT 1 FROM "PartnerService" s WHERE s."partnerId" = x."id" AND s."isActive" AND s."categoryId" = ${f.categoryId}::uuid)` : Prisma.empty}
      ${f.city ? Prisma.sql`AND x."city" ILIKE ${likeText(f.city)}` : Prisma.empty}
      ${n.cond}`;
    const order = Prisma.sql`${rank(Prisma.sql`x."businessName"`, p)}, ${n.order} x."ratingAvg" DESC, x."id"`;
    const { rows, total } = await this.page(base, where, order, limit, skip, count, Prisma.sql`x."id", ${n.dist} AS meters`);
    const partners = await this.prisma.servicePartner.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, slug: true, businessName: true, area: true, city: true, ratingAvg: true, ratingCount: true, homeVisitRadiusKm: true, services: { where: { isActive: true }, select: { pricePaise: true, category: { select: { name: true } } } } },
    });
    const by = new Map(partners.map((x) => [x.id, x]));
    return {
      total,
      items: rows.map((r) => ({ r, x: by.get(r.id) })).filter((o): o is { r: typeof o.r; x: NonNullable<typeof o.x> } => !!o.x).map(({ r, x }) => ({
        type: 'PARTNER' as const, id: x.id, title: x.businessName, subtitle: [[x.area, x.city].filter(Boolean).join(', '), [...new Set(x.services.map((s) => s.category.name))].slice(0, 3).join(', ')].filter(Boolean).join(' · '),
        imageUrl: null, link: { kind: 'service' as const, key: x.slug },
        meta: {
          ratingAvg: x.ratingAvg, ratingCount: x.ratingCount, fromPaise: x.services.length ? Math.min(...x.services.map((s) => s.pricePaise)) : null,
          homeVisits: x.homeVisitRadiusKm > 0, distance: distanceText(r.meters ?? null),
        },
      })),
    };
  }

  private async contests(p: Pattern, f: Partial<SearchQuery>, limit: number, skip: number, count: boolean) {
    const statuses = (f.when && CONTEST_WHEN[f.when]) || CONTEST_PUBLIC;
    const base = Prisma.sql`FROM "Contest" x`;
    const where = Prisma.sql`x."status"::text = ANY(${statuses}::text[]) AND x."title" ILIKE ${p.contains}
      ${f.categoryId ? Prisma.sql`AND x."categoryId" = ${f.categoryId}::uuid` : Prisma.empty}`;
    // Live contests before finished ones.
    const order = Prisma.sql`${rank(Prisma.sql`x."title"`, p)}, (x."status" IN ('COMPLETED', 'WINNER_DECLARATION', 'EVALUATION')), x."registrationClosesAt" DESC, x."id"`;
    const { rows, total } = await this.page(base, where, order, limit, skip, count);
    const contests = await this.prisma.contest.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, slug: true, title: true, bannerUrl: true, status: true, feePaise: true, category: { select: { name: true } }, _count: { select: { participants: { where: { status: { in: ['REGISTERED', 'SUBMITTED', 'QUALIFIED', 'FINALIST', 'WINNER'] } } } } } },
    });
    const by = new Map(contests.map((x) => [x.id, x]));
    return {
      total,
      items: rows.map((r) => by.get(r.id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({
        type: 'CONTEST' as const, id: x.id, title: x.title, subtitle: [CONTEST_LABEL[x.status] ?? x.status, x.category?.name].filter(Boolean).join(' · '),
        imageUrl: x.bannerUrl, link: { kind: 'contest' as const, key: x.slug }, meta: { status: x.status, feePaise: x.feePaise, entries: x._count.participants },
      })),
    };
  }

  private async challenges(p: Pattern, f: Partial<SearchQuery>, limit: number, skip: number, count: boolean) {
    const when =
      f.when === 'active' ? Prisma.sql`AND x."status" = 'PUBLISHED' AND x."startsAt" <= now() AND x."endsAt" > now()`
      : f.when === 'upcoming' ? Prisma.sql`AND x."status" = 'PUBLISHED' AND x."startsAt" > now()`
      : f.when === 'past' ? Prisma.sql`AND (x."status" = 'ENDED' OR x."endsAt" <= now())`
      : Prisma.empty;
    const base = Prisma.sql`FROM "Challenge" x`;
    const where = Prisma.sql`x."status" IN ('PUBLISHED', 'ENDED') AND x."title" ILIKE ${p.contains} ${when}`;
    const order = Prisma.sql`${rank(Prisma.sql`x."title"`, p)}, (x."endsAt" <= now()), x."startsAt" DESC, x."id"`;
    const { rows, total } = await this.page(base, where, order, limit, skip, count);
    const now = new Date();
    const list = await this.prisma.challenge.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, slug: true, title: true, bannerUrl: true, status: true, startsAt: true, endsAt: true, feePaise: true, requiredCheckIns: true, _count: { select: { participants: true } } },
    });
    const by = new Map(list.map((x) => [x.id, x]));
    return {
      total,
      items: rows.map((r) => by.get(r.id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => {
        const state = x.status === 'ENDED' || x.endsAt <= now ? 'Finished' : x.startsAt > now ? 'Starting soon' : 'On now';
        return {
          type: 'CHALLENGE' as const, id: x.id, title: x.title, subtitle: `${state} · ${x.requiredCheckIns} check-in${x.requiredCheckIns === 1 ? '' : 's'}`,
          imageUrl: x.bannerUrl, link: { kind: 'challenge' as const, key: x.slug }, meta: { state, feePaise: x.feePaise, participants: x._count.participants },
        };
      }),
    };
  }
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
