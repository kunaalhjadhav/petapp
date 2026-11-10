import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import { PostsService } from '../posts/posts.service';
import { RecoService } from '../recommendations/reco.service';
import { PET_CARD_SELECT } from '../pets/pets.service';
import { Paged } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import { petDistanceKm } from '../locations/locations.rules';
import type { NearbyPetsQuery } from './discover.dto';

const LIVE_ENTRY = ['REGISTERED', 'SUBMITTED', 'QUALIFIED', 'FINALIST', 'WINNER'] as const;
const PUBLIC_PET = { deletedAt: null, status: 'ACTIVE', visibility: 'PUBLIC', owner: { status: 'ACTIVE' } } satisfies Prisma.PetWhereInput;

/**
 * Pet discovery (spec §62): trending pets, pets near you (only pets whose owners turned it on, shown with a
 * rounded distance, never a location), popular reels, and pets taking part in contests and challenges.
 */
@Injectable()
export class DiscoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly posts: PostsService,
    private readonly reco: RecoService,
  ) {}

  private async blocked(userId?: string) {
    return [...(await this.posts.viewer(userId)).blocked];
  }

  async trendingPets(userId: string | undefined, limit: number) {
    return this.reco.trendingPets(await this.reco.who(userId), limit);
  }

  async nearbyPets(userId: string | undefined, q: NearbyPetsQuery) {
    const radius = q.radiusKm ?? (await this.platform.getSetting<number>('discover.nearbyRadiusKm'));
    const at = Prisma.sql`ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography`;
    const blocked = await this.blocked(userId);
    const where = Prisma.sql`p."discoverable" AND p."deletedAt" IS NULL AND p."status" = 'ACTIVE' AND p."visibility" = 'PUBLIC' AND p."location" IS NOT NULL
      AND u."status" = 'ACTIVE' AND ST_DWithin(p."location", ${at}, ${radius * 1000})
      ${userId ? Prisma.sql`AND p."ownerId" <> ${userId}::uuid` : Prisma.empty}
      ${blocked.length ? Prisma.sql`AND p."ownerId" <> ALL(${blocked}::uuid[])` : Prisma.empty}
      ${q.speciesId ? Prisma.sql`AND p."speciesId" = ${q.speciesId}::uuid` : Prisma.empty}`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; meters: number }>>`
      SELECT p."id", ST_Distance(p."location", ${at}) AS meters FROM "Pet" p JOIN "User" u ON u."id" = p."ownerId"
      WHERE ${where} ORDER BY meters, p."id" LIMIT ${q.limit} OFFSET ${q.skip}`;
    const [{ n }] = await this.prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM "Pet" p JOIN "User" u ON u."id" = p."ownerId" WHERE ${where}`;
    const pets = await this.prisma.pet.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: PET_CARD_SELECT });
    const by = new Map(pets.map((p) => [p.id, p]));
    return Paged.of(
      rows.filter((r) => by.has(r.id)).map((r) => ({ ...by.get(r.id)!, distanceKm: petDistanceKm(r.meters) })),
      n, q,
    );
  }

  async popularReels(userId: string | undefined, cursor: string | undefined, limit: number) {
    return this.posts.trending(await this.posts.viewer(userId), cursor, limit, 'reels');
  }

  /** Pets entered in contests that are open or in voting, newest first. */
  async contestEntries(userId: string | undefined, limit: number) {
    const blocked = await this.blocked(userId);
    const rows = await this.prisma.contestParticipant.findMany({
      where: {
        status: { in: [...LIVE_ENTRY] },
        contest: { status: { in: ['LIVE', 'VOTING'] } },
        pet: PUBLIC_PET,
        ...(blocked.length ? { userId: { notIn: blocked } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, status: true, pet: { select: PET_CARD_SELECT }, contest: { select: { id: true, slug: true, title: true, status: true, bannerUrl: true } } },
    });
    return rows.map((r) => ({ entryId: r.id, status: r.status, pet: r.pet, contest: r.contest, voting: r.contest.status === 'VOTING' }));
  }

  /** Pets in challenges that are on now, by points. */
  async challengeEntries(userId: string | undefined, limit: number) {
    const blocked = await this.blocked(userId);
    const now = new Date();
    const rows = await this.prisma.challengeParticipant.findMany({
      where: {
        status: { in: ['ACTIVE', 'COMPLETED'] },
        challenge: { status: 'PUBLISHED', startsAt: { lte: now }, endsAt: { gt: now } },
        pet: PUBLIC_PET,
        ...(blocked.length ? { userId: { notIn: blocked } } : {}),
      },
      orderBy: [{ points: 'desc' }, { checkIns: 'desc' }],
      take: limit,
      select: { id: true, status: true, points: true, checkIns: true, pet: { select: PET_CARD_SELECT }, challenge: { select: { id: true, slug: true, title: true, requiredCheckIns: true, bannerUrl: true } } },
    });
    return rows.filter((r) => r.pet).map((r) => ({ entryId: r.id, status: r.status, points: r.points, checkIns: r.checkIns, pet: r.pet!, challenge: r.challenge, completed: r.status === 'COMPLETED' }));
  }
}
