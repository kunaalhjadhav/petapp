import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { BreedDto, SpeciesDto, UpdateBreedDto, UpdateSpeciesDto } from './dto/pets.dto';

@Injectable()
export class SpeciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false) {
    const rows = await this.prisma.petSpecies.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { breeds: includeInactive ? true : { where: { isActive: true } } } } },
    });
    return rows.map(({ _count, ...s }) => ({ ...s, breedCount: _count.breeds }));
  }

  async breeds(speciesId: string, includeInactive = false) {
    const species = await this.prisma.petSpecies.findUnique({ where: { id: speciesId }, select: { id: true, isActive: true } });
    if (!species || (!includeInactive && !species.isActive)) throw new NotFoundException('Species not found.');
    return this.prisma.petBreed.findMany({ where: { speciesId, isActive: includeInactive ? undefined : true }, orderBy: { name: 'asc' } });
  }

  createSpecies(actorId: string, dto: SpeciesDto, meta: RequestMetaInfo) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.petSpecies.create({ data: dto });
      await this.audit.log({ actorId, action: 'species.create', entityType: 'PetSpecies', entityId: s.id, after: dto, meta }, tx);
      return s;
    });
  }

  updateSpecies(actorId: string, id: string, dto: UpdateSpeciesDto, meta: RequestMetaInfo) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.petSpecies.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Species not found.');
      const s = await tx.petSpecies.update({ where: { id }, data: dto });
      await this.audit.log({ actorId, action: 'species.update', entityType: 'PetSpecies', entityId: id, before, after: dto, meta }, tx);
      return s;
    });
  }

  createBreed(actorId: string, speciesId: string, dto: BreedDto, meta: RequestMetaInfo) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.petSpecies.findUnique({ where: { id: speciesId } }))) throw new NotFoundException('Species not found.');
      const b = await tx.petBreed.create({ data: { ...dto, speciesId } });
      await this.audit.log({ actorId, action: 'breed.create', entityType: 'PetBreed', entityId: b.id, after: { ...dto, speciesId }, meta }, tx);
      return b;
    });
  }

  updateBreed(actorId: string, id: string, dto: UpdateBreedDto, meta: RequestMetaInfo) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.petBreed.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Breed not found.');
      const b = await tx.petBreed.update({ where: { id }, data: dto });
      await this.audit.log({ actorId, action: 'breed.update', entityType: 'PetBreed', entityId: id, before, after: dto, meta }, tx);
      return b;
    });
  }
}
