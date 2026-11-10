import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import { AuditService } from '../audit/audit.service';
import { PostsService } from '../posts/posts.service';
import { OrdersService } from '../marketplace/orders.service';
import { ContestsService } from '../contests/contests.service';
import { ChallengesService } from '../challenges/challenges.service';
import type { HomeSection, HomeSectionKind, Prisma } from '../../generated/prisma/client';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { RecoService, type Who } from './reco.service';
import { sectionShown, withPins } from './reco.rules';
import type { CreateHomeSectionDto, UpdateHomeSectionDto } from './reco.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PINS = 20;

/** What each kind of section needs switched on. */
const NEEDS: Record<HomeSectionKind, 'ENABLE_REELS' | 'ENABLE_CONTESTS' | 'ENABLE_SERVICES' | 'ENABLE_MARKETPLACE' | null> = {
  FEATURED_REELS: 'ENABLE_REELS',
  TRENDING_PETS: null,
  ACTIVE_CONTESTS: 'ENABLE_CONTESTS',
  CHALLENGES: 'ENABLE_CONTESTS',
  NEARBY_SERVICES: 'ENABLE_SERVICES',
  RECOMMENDED_PRODUCTS: 'ENABLE_MARKETPLACE',
  PARTNER_OFFERS: 'ENABLE_MARKETPLACE',
  UPCOMING_EVENTS: null,
};

/** What admins can pin in each kind of section, for messages. */
export const PIN_WHAT: Record<HomeSectionKind, string | null> = {
  FEATURED_REELS: 'a reel (its id or link)',
  TRENDING_PETS: 'a pet (its @handle, id or link)',
  ACTIVE_CONTESTS: 'a contest (its id, slug or link)',
  CHALLENGES: 'a challenge (its id, slug or link)',
  NEARBY_SERVICES: 'a service partner (their id, slug or link)',
  RECOMMENDED_PRODUCTS: 'a product (its id, slug or link)',
  PARTNER_OFFERS: 'a coupon (its code)',
  UPCOMING_EVENTS: null,
};

type Item = { id: string; reason: string | null };
export interface BuiltSection {
  id: string;
  kind: HomeSectionKind;
  title: string;
  subtitle: string | null;
  items: Array<Item & { pinned: boolean }>;
}

@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly audit: AuditService,
    private readonly reco: RecoService,
    private readonly posts: PostsService,
    private readonly orders: OrdersService,
    private readonly contests: ContestsService,
    private readonly challenges: ChallengesService,
  ) {}

  // ═════════════ the app's home screen ═════════════

  async home(who: Who) {
    const { sections } = await this.build(who);
    return { city: who.city, personalised: who.personalised, sections };
  }

  /** Active sections this person should see, with their items; empty sections are left out (with the reason, for previews). */
  async build(who: Who) {
    const [rows, flags] = await Promise.all([
      this.prisma.homeSection.findMany({ where: { isActive: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.platform.flags(),
    ]);
    const now = new Date();
    const skipped: Array<{ id: string; why: string }> = [];
    const built = await Promise.all(
      rows.map(async (s): Promise<BuiltSection | null> => {
        const need = NEEDS[s.kind];
        if (need && !flags[need]) return skip(skipped, s, `${FEATURE_NAME[need]} is switched off`);
        if (!sectionShown(s, { city: who.city, speciesIds: who.speciesIds }, now)) return skip(skipped, s, why(s, who, now));
        const items = await this.items(s, who, { contests: flags.ENABLE_CONTESTS, services: flags.ENABLE_SERVICES });
        if (!items.length) return skip(skipped, s, s.kind === 'PARTNER_OFFERS' && !s.pinnedIds.length ? 'no offers picked yet' : 'nothing to show here right now');
        return { id: s.id, kind: s.kind, title: s.title, subtitle: s.subtitle, items };
      }),
    );
    return { sections: built.filter((b): b is BuiltSection => b !== null), skipped };
  }

  private async items(s: HomeSection, who: Who, on: { contests: boolean; services: boolean }): Promise<BuiltSection['items']> {
    const n = s.itemLimit;
    const pins = s.pinnedIds;
    const pinned = (list: Array<{ id: string }>) => list.map((x) => ({ ...x, reason: null as string | null }));
    switch (s.kind) {
      case 'FEATURED_REELS': {
        const viewer = await this.posts.viewer(who.userId);
        const top = (await this.reco.rankReelIds(who, 200)).slice(0, n + pins.length);
        const [p, r] = await Promise.all([this.posts.byIds(pins, viewer), this.posts.byIds(top.map((t) => t.id), viewer)]);
        const why = new Map(top.map((t) => [t.id, t.r]));
        return withPins(pinned(p), r.map((x) => ({ ...x, reason: why.get(x.id) ?? null })), n);
      }
      case 'TRENDING_PETS':
        return withPins(pinned(await this.reco.petCards(pins)), await this.reco.trendingPets(who, n, pins), n);
      case 'ACTIVE_CONTESTS':
        return withPins(pinned(await this.contests.cardsByIds(pins)), await this.reco.contests(who, n, pins), n);
      case 'CHALLENGES':
        return withPins(pinned(await this.challenges.cardsByIds(pins, who.userId)), await this.reco.challenges(who, n, pins), n);
      case 'NEARBY_SERVICES':
        return withPins(pinned(await this.reco.partnerCards(pins, who)), await this.reco.partners(who, n, pins), n);
      case 'RECOMMENDED_PRODUCTS':
        return withPins(pinned(await this.orders.cardsByIds(pins)), await this.reco.products(who, n, pins), n);
      case 'PARTNER_OFFERS':
        return withPins([], await this.reco.offers(pins), n);
      case 'UPCOMING_EVENTS':
        return withPins([], await this.reco.upcoming(who, n, on), n);
    }
  }

  // ═════════════ admin ═════════════

  async list() {
    const rows = await this.prisma.homeSection.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    const labels = await this.pinLabels(rows);
    return rows.map((r) => this.view(r, labels));
  }

  async one(id: string) {
    const r = await this.prisma.homeSection.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Section not found.');
    return this.view(r, await this.pinLabels([r]));
  }

  private view(r: HomeSection, labels: Map<string, { label: string; live: boolean }>) {
    return {
      ...r,
      pinsAllowed: PIN_WHAT[r.kind] !== null,
      pinWhat: PIN_WHAT[r.kind],
      pins: r.pinnedIds.map((id) => ({ id, ...(labels.get(id) ?? { label: 'No longer exists', live: false }) })),
    };
  }

  async create(actorId: string, dto: CreateHomeSectionDto, meta: RequestMetaInfo) {
    checkSchedule(date(dto.startsAt), date(dto.endsAt));
    const last = await this.prisma.homeSection.aggregate({ _max: { position: true } });
    const s = await this.prisma.homeSection.create({
      data: {
        kind: dto.kind, title: dto.title.trim(), subtitle: dto.subtitle?.trim() || null, position: (last._max.position ?? 0) + 1,
        isActive: dto.isActive ?? true, startsAt: date(dto.startsAt) ?? null, endsAt: date(dto.endsAt) ?? null,
        cities: cities(dto.cities), speciesIds: await this.species(dto.speciesIds), itemLimit: dto.itemLimit ?? 10,
        createdById: actorId, updatedById: actorId,
      },
    });
    await this.audit.log({ actorId, action: 'home.section_create', entityType: 'HomeSection', entityId: s.id, after: s, meta });
    return this.one(s.id);
  }

  async update(actorId: string, id: string, dto: UpdateHomeSectionDto, meta: RequestMetaInfo) {
    const before = await this.prisma.homeSection.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Section not found.');
    const startsAt = dto.startsAt === undefined ? before.startsAt : date(dto.startsAt)!;
    const endsAt = dto.endsAt === undefined ? before.endsAt : date(dto.endsAt)!;
    checkSchedule(startsAt, endsAt);
    const s = await this.prisma.homeSection.update({
      where: { id },
      data: {
        title: dto.title?.trim(), subtitle: dto.subtitle === undefined ? undefined : dto.subtitle?.trim() || null,
        isActive: dto.isActive, startsAt, endsAt, itemLimit: dto.itemLimit,
        cities: dto.cities === undefined ? undefined : cities(dto.cities),
        speciesIds: dto.speciesIds === undefined ? undefined : await this.species(dto.speciesIds),
        updatedById: actorId,
      },
    });
    await this.audit.log({ actorId, action: 'home.section_update', entityType: 'HomeSection', entityId: id, before, after: s, meta });
    return this.one(id);
  }

  async remove(actorId: string, id: string, meta: RequestMetaInfo) {
    const before = await this.prisma.homeSection.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Section not found.');
    await this.prisma.homeSection.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'home.section_delete', entityType: 'HomeSection', entityId: id, before, meta });
  }

  async reorder(actorId: string, ids: string[], meta: RequestMetaInfo) {
    const all = await this.prisma.homeSection.findMany({ select: { id: true, position: true }, orderBy: { position: 'asc' } });
    if (ids.length !== all.length || new Set(ids).size !== ids.length || !all.every((s) => ids.includes(s.id))) {
      throw new BadRequestException('Send every section once, in the new order.');
    }
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.homeSection.update({ where: { id }, data: { position: i + 1, updatedById: actorId } })));
    await this.audit.log({ actorId, action: 'home.sections_reorder', entityType: 'HomeSection', before: all.map((s) => s.id), after: ids, meta });
    return this.list();
  }

  async addPin(actorId: string, id: string, ref: string, meta: RequestMetaInfo) {
    const s = await this.prisma.homeSection.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Section not found.');
    if (!PIN_WHAT[s.kind]) throw new BadRequestException('This section is different for everyone, so items can’t be pinned to it.');
    if (s.pinnedIds.length >= MAX_PINS) throw new BadRequestException(`A section can have up to ${MAX_PINS} pinned items.`);
    const itemId = await this.resolve(s.kind, ref);
    if (!itemId) throw new BadRequestException(`Couldn’t find that. Enter ${PIN_WHAT[s.kind]}.`);
    if (s.pinnedIds.includes(itemId)) throw new BadRequestException('That is already pinned here.');
    const after = await this.prisma.homeSection.update({ where: { id }, data: { pinnedIds: [...s.pinnedIds, itemId], updatedById: actorId } });
    await this.audit.log({ actorId, action: 'home.pin_add', entityType: 'HomeSection', entityId: id, after: { itemId, pinnedIds: after.pinnedIds }, meta });
    return this.one(id);
  }

  async removePin(actorId: string, id: string, itemId: string, meta: RequestMetaInfo) {
    const s = await this.prisma.homeSection.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Section not found.');
    if (!s.pinnedIds.includes(itemId)) throw new NotFoundException('That isn’t pinned here.');
    const after = await this.prisma.homeSection.update({ where: { id }, data: { pinnedIds: s.pinnedIds.filter((x) => x !== itemId), updatedById: actorId } });
    await this.audit.log({ actorId, action: 'home.pin_remove', entityType: 'HomeSection', entityId: id, before: { itemId }, after: { pinnedIds: after.pinnedIds }, meta });
    return this.one(id);
  }

  /** A pasted link, @handle, slug, code or id → the item's id, if it exists. */
  private async resolve(kind: HomeSectionKind, raw: string): Promise<string | null> {
    const ref = raw.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop()!.replace(/^@/, '');
    if (!ref) return null;
    const byId = UUID.test(ref) ? ref.toLowerCase() : null;
    switch (kind) {
      case 'FEATURED_REELS':
        return byId ? ((await this.prisma.post.findFirst({ where: { id: byId, type: 'REEL', deletedAt: null }, select: { id: true } }))?.id ?? null) : null;
      case 'TRENDING_PETS':
        return (await this.prisma.pet.findFirst({ where: { deletedAt: null, OR: [{ handle: ref.toLowerCase() }, ...(byId ? [{ id: byId }] : [])] }, select: { id: true } }))?.id ?? null;
      case 'ACTIVE_CONTESTS':
        return (await this.prisma.contest.findFirst({ where: { OR: [{ slug: ref }, ...(byId ? [{ id: byId }] : [])] }, select: { id: true } }))?.id ?? null;
      case 'CHALLENGES':
        return (await this.prisma.challenge.findFirst({ where: { OR: [{ slug: ref }, ...(byId ? [{ id: byId }] : [])] }, select: { id: true } }))?.id ?? null;
      case 'NEARBY_SERVICES':
        return (await this.prisma.servicePartner.findFirst({ where: { OR: [{ slug: ref }, ...(byId ? [{ id: byId }] : [])] }, select: { id: true } }))?.id ?? null;
      case 'RECOMMENDED_PRODUCTS':
        return (await this.prisma.product.findFirst({ where: { OR: [{ slug: ref }, ...(byId ? [{ id: byId }] : [])] }, select: { id: true } }))?.id ?? null;
      case 'PARTNER_OFFERS':
        return (await this.prisma.coupon.findFirst({ where: { OR: [{ code: ref.toUpperCase() }, ...(byId ? [{ id: byId }] : [])] }, select: { id: true } }))?.id ?? null;
      case 'UPCOMING_EVENTS':
        return null;
    }
  }

  /** Names of pinned items, and whether each would show today. */
  private async pinLabels(rows: HomeSection[]) {
    const ids = (k: HomeSectionKind) => [...new Set(rows.filter((r) => r.kind === k).flatMap((r) => r.pinnedIds))];
    const now = new Date();
    const out = new Map<string, { label: string; live: boolean }>();
    const put = (id: string, label: string, live: boolean) => out.set(id, { label, live });
    const [reels, pets, contests, challenges, partners, products, coupons] = await Promise.all([
      this.prisma.post.findMany({ where: { id: { in: ids('FEATURED_REELS') } }, select: { id: true, caption: true, status: true, visibility: true, deletedAt: true, author: { select: { name: true } } } }),
      this.prisma.pet.findMany({ where: { id: { in: ids('TRENDING_PETS') } }, select: { id: true, name: true, handle: true, status: true, visibility: true, deletedAt: true } }),
      this.prisma.contest.findMany({ where: { id: { in: ids('ACTIVE_CONTESTS') } }, select: { id: true, title: true, status: true } }),
      this.prisma.challenge.findMany({ where: { id: { in: ids('CHALLENGES') } }, select: { id: true, title: true, status: true, endsAt: true } }),
      this.prisma.servicePartner.findMany({ where: { id: { in: ids('NEARBY_SERVICES') } }, select: { id: true, businessName: true, city: true, status: true } }),
      this.prisma.product.findMany({ where: { id: { in: ids('RECOMMENDED_PRODUCTS') } }, select: { id: true, title: true, status: true, vendor: { select: { businessName: true, status: true } } } }),
      this.prisma.coupon.findMany({ where: { id: { in: ids('PARTNER_OFFERS') } }, select: { id: true, code: true, isActive: true, startsAt: true, endsAt: true, usageLimit: true, usedCount: true, vendor: { select: { businessName: true } } } }),
    ]);
    for (const r of reels) put(r.id, `${r.caption?.slice(0, 60) || 'Reel'} · ${r.author.name ?? 'someone'}`, r.status === 'PUBLISHED' && r.visibility === 'PUBLIC' && !r.deletedAt);
    for (const p of pets) put(p.id, `${p.name} (@${p.handle})`, p.status === 'ACTIVE' && p.visibility === 'PUBLIC' && !p.deletedAt);
    for (const c of contests) put(c.id, c.title, ['SCHEDULED', 'LIVE', 'VOTING', 'EVALUATION', 'WINNER_DECLARATION', 'COMPLETED'].includes(c.status));
    for (const c of challenges) put(c.id, c.title, c.status === 'PUBLISHED' && c.endsAt > now);
    for (const p of partners) put(p.id, `${p.businessName}, ${p.city}`, p.status === 'APPROVED');
    for (const p of products) put(p.id, `${p.title} · ${p.vendor.businessName}`, p.status === 'ACTIVE' && p.vendor.status === 'APPROVED');
    for (const c of coupons) put(c.id, `${c.code}${c.vendor ? ` · ${c.vendor.businessName}` : ''}`, c.isActive && c.startsAt <= now && c.endsAt > now && (c.usageLimit === null || c.usedCount < c.usageLimit));
    return out;
  }

  private async species(ids?: string[]) {
    if (!ids?.length) return [];
    const found = await this.prisma.petSpecies.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== new Set(ids).size) throw new BadRequestException('Unknown species.');
    return [...new Set(ids)];
  }
}

const FEATURE_NAME = { ENABLE_REELS: 'Reels', ENABLE_CONTESTS: 'Contests', ENABLE_SERVICES: 'Services', ENABLE_MARKETPLACE: 'The shop' } as const;

function skip(list: Array<{ id: string; why: string }>, s: HomeSection, why: string): null {
  list.push({ id: s.id, why });
  return null;
}

function why(s: HomeSection, who: Who, now: Date) {
  if (s.startsAt && now < s.startsAt) return 'scheduled for later';
  if (s.endsAt && now >= s.endsAt) return 'its schedule has ended';
  if (s.cities.length && !(who.city && s.cities.includes(who.city.trim().toLowerCase()))) return 'only for other cities';
  return 'only for people with certain pets';
}

const date = (v?: string | null) => (v === undefined ? undefined : v === null ? null : new Date(v));

const cities = (list?: string[]) => [...new Set((list ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean))];

function checkSchedule(startsAt?: Date | null, endsAt?: Date | null) {
  if (startsAt && endsAt && startsAt >= endsAt) throw new BadRequestException('The end must be after the start.');
}

export type HomeSectionView = Awaited<ReturnType<HomeService['one']>>;
export type { Prisma };
