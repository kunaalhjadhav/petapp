import { likeText } from '../../common/utils/search';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { QueueService } from '../../queue/queue.service';
import { Paged } from '../../common/dto/pagination.dto';
import { handleCandidate } from '../../common/utils/slug';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { Prisma, type Pet } from '../../generated/prisma/client';
import type {
  AdminPetsQuery, CreatePetDto, DiscoverPetsQuery, PetStatusDto, UpdatePetDto, VaccinationDto,
} from './dto/pets.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PET_CARD_SELECT = {
  id: true, name: true, handle: true, avatarUrl: true, gender: true, dateOfBirth: true, city: true,
  isVerified: true, followerCount: true, visibility: true,
  species: { select: { id: true, key: true, name: true } },
  breed: { select: { id: true, name: true } },
} satisfies Prisma.PetSelect;

const FULL_INCLUDE = {
  species: { select: { id: true, key: true, name: true } },
  breed: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true, avatarUrl: true } },
  vaccinations: { orderBy: { givenOn: 'desc' as const } },
} satisfies Prisma.PetInclude;

type FullPet = Prisma.PetGetPayload<{ include: typeof FULL_INCLUDE }>;

@Injectable()
export class PetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platform: PlatformService,
    private readonly queue: QueueService,
  ) {}

  // ── owner ──

  mine(userId: string) {
    return this.prisma.pet.findMany({ where: { ownerId: userId, deletedAt: null }, select: { ...PET_CARD_SELECT, status: true }, orderBy: { createdAt: 'asc' } });
  }

  async create(userId: string, dto: CreatePetDto, meta: RequestMetaInfo) {
    const max = await this.platform.getSetting<number>('pets.maxPerUser');
    const count = await this.prisma.pet.count({ where: { ownerId: userId, deletedAt: null } });
    if (count >= max) throw new BadRequestException(`You can add up to ${max} pets.`);
    await this.assertSpeciesBreed(dto.speciesId, dto.breedId);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const pet = await this.prisma.$transaction(async (tx) => {
          const p = await tx.pet.create({
            data: { ...this.toData(dto), ownerId: userId, speciesId: dto.speciesId, name: dto.name, handle: handleCandidate(dto.name) },
            include: FULL_INCLUDE,
          });
          await this.audit.log({ actorId: userId, action: 'pet.create', entityType: 'Pet', entityId: p.id, meta }, tx);
          return p;
        });
        this.queue.assess('PET', pet.id);
        return this.present(pet, true);
      } catch (e) {
        const handleClash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!handleClash || attempt === 4) throw e;
      }
    }
    throw new BadRequestException('Could not create the pet. Please try again.');
  }

  async update(userId: string, id: string, dto: UpdatePetDto) {
    const pet = await this.owned(userId, id);
    if (dto.breedId) await this.assertSpeciesBreed(pet.speciesId, dto.breedId);
    const updated = await this.prisma.pet.update({ where: { id }, data: this.toData(dto), include: FULL_INCLUDE });
    if (dto.name !== undefined || dto.about !== undefined) this.queue.assess('PET', id);
    return this.present(updated, true);
  }

  async remove(userId: string, id: string, meta: RequestMetaInfo) {
    await this.owned(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.pet.update({ where: { id }, data: { deletedAt: new Date(), status: 'REMOVED' } });
      await tx.petFollower.deleteMany({ where: { petId: id } });
      await this.audit.log({ actorId: userId, action: 'pet.delete', entityType: 'Pet', entityId: id, meta }, tx);
    });
  }

  async addVaccination(userId: string, petId: string, dto: VaccinationDto) {
    await this.owned(userId, petId);
    const max = await this.platform.getSetting<number>('pets.maxVaccinationsPerPet');
    if ((await this.prisma.petVaccination.count({ where: { petId } })) >= max) throw new BadRequestException(`Up to ${max} vaccination records per pet.`);
    return this.prisma.petVaccination.create({
      data: { petId, name: dto.name, notes: dto.notes, givenOn: dto.givenOn ? new Date(dto.givenOn) : null, validUntil: dto.validUntil ? new Date(dto.validUntil) : null },
    });
  }

  async removeVaccination(userId: string, petId: string, vaccinationId: string) {
    await this.owned(userId, petId);
    const res = await this.prisma.petVaccination.deleteMany({ where: { id: vaccinationId, petId } });
    if (!res.count) throw new NotFoundException('Vaccination record not found.');
  }

  // ── public ──

  async view(idOrHandle: string, viewerId?: string) {
    const where: Prisma.PetWhereInput = UUID.test(idOrHandle) ? { id: idOrHandle } : { handle: idOrHandle.toLowerCase() };
    const pet = await this.prisma.pet.findFirst({ where: { ...where, deletedAt: null }, include: FULL_INCLUDE });
    const notFound = new NotFoundException('Pet not found.');
    if (!pet || pet.status === 'REMOVED') throw notFound;

    const isOwner = !!viewerId && viewerId === pet.ownerId;
    if (viewerId && !isOwner && (await this.prisma.block.count({ where: { OR: [{ blockerId: viewerId, blockedId: pet.ownerId }, { blockerId: pet.ownerId, blockedId: viewerId }] } }))) {
      throw notFound;
    }
    const isFollowing = viewerId && !isOwner
      ? !!(await this.prisma.petFollower.findUnique({ where: { userId_petId: { userId: viewerId, petId: pet.id } } }))
      : false;

    if (!isOwner) {
      if (pet.status === 'HIDDEN' || pet.visibility === 'PRIVATE') throw notFound;
      if (pet.visibility === 'FOLLOWERS' && !isFollowing) {
        return { ...this.card(pet), isFollowing, restricted: true };
      }
    }
    return { ...this.present(pet, isOwner), isOwner, isFollowing, restricted: false };
  }

  async discover(q: DiscoverPetsQuery) {
    const where: Prisma.PetWhereInput = {
      deletedAt: null, status: 'ACTIVE', visibility: 'PUBLIC', owner: { status: 'ACTIVE' },
      speciesId: q.speciesId, breedId: q.breedId,
      city: q.city ? { equals: q.city, mode: 'insensitive' } : undefined,
      name: q.search ? { contains: likeText(q.search), mode: 'insensitive' } : undefined,
    };
    const orderBy: Prisma.PetOrderByWithRelationInput[] = q.sort === 'new' ? [{ createdAt: 'desc' }] : [{ followerCount: 'desc' }, { createdAt: 'desc' }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.pet.findMany({ where, orderBy, skip: q.skip, take: q.limit, select: PET_CARD_SELECT }),
      this.prisma.pet.count({ where }),
    ]);
    return Paged.of(items, total, q);
  }

  async follow(userId: string, petId: string) {
    const pet = await this.prisma.pet.findFirst({ where: { id: petId, deletedAt: null, status: 'ACTIVE', visibility: { not: 'PRIVATE' } }, select: { ownerId: true } });
    if (!pet) throw new NotFoundException('Pet not found.');
    if (pet.ownerId === userId) throw new BadRequestException('You cannot follow your own pet.');
    if (await this.prisma.block.count({ where: { OR: [{ blockerId: userId, blockedId: pet.ownerId }, { blockerId: pet.ownerId, blockedId: userId }] } })) {
      throw new NotFoundException('Pet not found.');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.petFollower.createMany({ data: [{ userId, petId }], skipDuplicates: true });
      if (count) await tx.pet.update({ where: { id: petId }, data: { followerCount: { increment: 1 } } });
      return count;
    }).then((count) => {
      if (count) this.queue.notify({ type: 'PET_FOLLOWER', actorId: userId, petId });
    });
    return { following: true };
  }

  async unfollow(userId: string, petId: string) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.petFollower.deleteMany({ where: { userId, petId } });
      if (count) await tx.pet.update({ where: { id: petId }, data: { followerCount: { decrement: 1 } } });
    });
    return { following: false };
  }

  // ── admin ──

  async adminList(q: AdminPetsQuery) {
    const where: Prisma.PetWhereInput = {
      status: q.status, ownerId: q.ownerId, speciesId: q.speciesId, breedId: q.breedId,
      isVerified: q.verified === undefined ? undefined : q.verified === 'true',
      city: q.city ? { equals: q.city, mode: 'insensitive' } : undefined,
      OR: q.search ? [{ name: { contains: likeText(q.search), mode: 'insensitive' } }, { handle: { contains: likeText(q.search.toLowerCase()) } }] : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.pet.findMany({
        where, skip: q.skip, take: q.limit,
        orderBy: q.sort === 'popular' ? { followerCount: 'desc' } : { createdAt: 'desc' },
        select: { ...PET_CARD_SELECT, status: true, deletedAt: true, createdAt: true, owner: { select: { id: true, name: true, phone: true } } },
      }),
      this.prisma.pet.count({ where }),
    ]);
    return Paged.of(items, total, q);
  }

  async adminDetail(id: string) {
    const pet = await this.prisma.pet.findUnique({ where: { id }, include: FULL_INCLUDE });
    if (!pet) throw new NotFoundException('Pet not found.');
    return this.present(pet, true);
  }

  async adminVerify(actorId: string, id: string, isVerified: boolean, meta: RequestMetaInfo) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.pet.findUnique({ where: { id }, select: { isVerified: true } });
      if (!before) throw new NotFoundException('Pet not found.');
      if (before.isVerified === isVerified) throw new BadRequestException(isVerified ? 'This pet is already verified.' : 'This pet is not verified.');
      const p = await tx.pet.update({ where: { id }, data: { isVerified }, select: { id: true, isVerified: true } });
      await this.audit.log({ actorId, action: 'pet.verify', entityType: 'Pet', entityId: id, before, after: { isVerified }, meta }, tx);
      return p;
    });
  }

  async adminSetStatus(actorId: string, id: string, dto: PetStatusDto, meta: RequestMetaInfo) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.pet.findUnique({ where: { id }, select: { status: true } });
      if (!before) throw new NotFoundException('Pet not found.');
      if (before.status === dto.status) throw new BadRequestException(`This pet is already ${dto.status.toLowerCase()}.`);
      const p = await tx.pet.update({ where: { id }, data: { status: dto.status }, select: { id: true, status: true } });
      await this.audit.log({ actorId, action: 'pet.status', entityType: 'Pet', entityId: id, before, after: { status: dto.status, reason: dto.reason }, meta }, tx);
      return p;
    });
  }

  // ── helpers ──

  private async owned(userId: string, id: string): Promise<Pet> {
    const pet = await this.prisma.pet.findFirst({ where: { id, ownerId: userId, deletedAt: null } });
    if (!pet) throw new NotFoundException('Pet not found.');
    return pet;
  }

  private async assertSpeciesBreed(speciesId: string, breedId?: string | null) {
    const species = await this.prisma.petSpecies.findFirst({ where: { id: speciesId, isActive: true }, select: { id: true } });
    if (!species) throw new BadRequestException({ message: 'Please choose a valid species.', errors: [{ field: 'speciesId', message: 'invalid' }] });
    if (breedId) {
      const breed = await this.prisma.petBreed.findFirst({ where: { id: breedId, speciesId, isActive: true }, select: { id: true } });
      if (!breed) throw new BadRequestException({ message: 'This breed does not belong to the selected species.', errors: [{ field: 'breedId', message: 'invalid' }] });
    }
  }

  private toData(dto: UpdatePetDto) {
    const { dateOfBirth, weightKg, personality, ...rest } = dto;
    return {
      ...rest,
      personality: personality?.map((p) => p.trim().toLowerCase()),
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      weightKg: weightKg !== undefined ? new Prisma.Decimal(weightKg) : undefined,
    };
  }

  private card(p: FullPet) {
    return {
      id: p.id, name: p.name, handle: p.handle, avatarUrl: p.avatarUrl, species: p.species, breed: p.breed,
      isVerified: p.isVerified, followerCount: p.followerCount, visibility: p.visibility,
    };
  }

  /** Owner-only fields (microchip, medical notes, vaccinations, exact coordinates) are stripped for everyone else. */
  private present(p: FullPet, full: boolean) {
    const base = {
      ...this.card(p),
      coverUrl: p.coverUrl, gender: p.gender, dateOfBirth: p.dateOfBirth, ageMonths: ageInMonths(p.dateOfBirth),
      weightKg: p.weightKg ? Number(p.weightKg) : null, color: p.color, about: p.about, personality: p.personality,
      city: p.city, status: p.status, owner: p.owner, createdAt: p.createdAt,
    };
    if (!full) return base;
    return {
      ...base,
      microchipId: p.microchipId, medicalNotes: p.medicalNotes, vaccinations: p.vaccinations,
      latitude: p.latitude ? Number(p.latitude) : null, longitude: p.longitude ? Number(p.longitude) : null,
      discoverable: p.discoverable,
    };
  }
}

export function ageInMonths(dob: Date | null, now = new Date()): number | null {
  if (!dob) return null;
  const m = (now.getUTCFullYear() - dob.getUTCFullYear()) * 12 + (now.getUTCMonth() - dob.getUTCMonth()) - (now.getUTCDate() < dob.getUTCDate() ? 1 : 0);
  return Math.max(0, m);
}
