import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import { RedisService } from '../../redis/redis.service';

/** Most URLs one sitemap file may hold is 50,000; each kind is capped well below that. */
export const SITEMAP_CAP = 10_000;
const CACHE_KEY = 'public:sitemap';
const CACHE_SECONDS = 600;

export interface SitemapEntry {
  /** The public identifier used in web URLs: a pet's handle, or a slug. */
  key: string;
  updatedAt: string;
}

export interface Sitemap {
  generatedAt: string;
  pets: SitemapEntry[];
  products: SitemapEntry[];
  services: SitemapEntry[];
  contests: SitemapEntry[];
  challenges: SitemapEntry[];
  legal: SitemapEntry[];
}

/**
 * What search engines may list: only things anyone can already see without signing in, and only for features that
 * are switched on. Private, followers-only, hidden and removed pets are never listed, and nor is anything about people.
 */
@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly redis: RedisService,
  ) {}

  async sitemap(): Promise<Sitemap> {
    const cached = await this.redis.client.get(CACHE_KEY).catch(() => null);
    if (cached) return JSON.parse(cached) as Sitemap;
    const flags = await this.platform.flags();
    const take = SITEMAP_CAP;
    const p = this.prisma;
    const [pets, products, services, contests, challenges, legal] = await Promise.all([
      p.pet.findMany({
        where: { deletedAt: null, status: 'ACTIVE', visibility: 'PUBLIC', owner: { status: 'ACTIVE' } },
        select: { handle: true, updatedAt: true },
        orderBy: { followerCount: 'desc' },
        take,
      }),
      flags.ENABLE_MARKETPLACE
        ? p.product.findMany({ where: { status: 'ACTIVE', vendor: { status: 'APPROVED' } }, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take })
        : [],
      flags.ENABLE_SERVICES
        ? p.servicePartner.findMany({ where: { status: 'APPROVED' }, select: { slug: true, updatedAt: true }, orderBy: { ratingCount: 'desc' }, take })
        : [],
      flags.ENABLE_CONTESTS
        ? p.contest.findMany({
            where: { status: { in: ['SCHEDULED', 'LIVE', 'VOTING', 'EVALUATION', 'WINNER_DECLARATION', 'COMPLETED'] } },
            select: { slug: true, updatedAt: true },
            orderBy: { registrationOpensAt: 'desc' },
            take,
          })
        : [],
      flags.ENABLE_CONTESTS
        ? p.challenge.findMany({ where: { status: { in: ['PUBLISHED', 'ENDED'] } }, select: { slug: true, updatedAt: true }, orderBy: { startsAt: 'desc' }, take })
        : [],
      p.legalDocument.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, updatedAt: true } }),
    ]);
    const out: Sitemap = {
      generatedAt: new Date().toISOString(),
      pets: pets.map((x) => ({ key: x.handle, updatedAt: x.updatedAt.toISOString() })),
      products: products.map((x) => ({ key: x.slug, updatedAt: x.updatedAt.toISOString() })),
      services: services.map((x) => ({ key: x.slug, updatedAt: x.updatedAt.toISOString() })),
      contests: contests.map((x) => ({ key: x.slug, updatedAt: x.updatedAt.toISOString() })),
      challenges: challenges.map((x) => ({ key: x.slug, updatedAt: x.updatedAt.toISOString() })),
      legal: legal.map((x) => ({ key: x.slug, updatedAt: x.updatedAt.toISOString() })),
    };
    await this.redis.client.set(CACHE_KEY, JSON.stringify(out), 'EX', CACHE_SECONDS).catch(() => undefined);
    return out;
  }
}
