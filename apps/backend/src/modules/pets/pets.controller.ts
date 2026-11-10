import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@petapp/types';
import {
  AdminOnly, CurrentUser, OptionalAuth, Public, RequestMeta, RequirePermissions, type RequestMetaInfo,
} from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { PetsService } from './pets.service';
import { SpeciesService } from './species.service';
import {
  AdminPetsQuery, BreedDto, CreatePetDto, DiscoverPetsQuery, PetStatusDto, PetVerifyDto, SpeciesDto, UpdateBreedDto,
  UpdatePetDto, UpdateSpeciesDto, VaccinationDto,
} from './dto/pets.dto';

@ApiTags('Pets')
@ApiBearerAuth()
@Controller('pets')
export class PetsController {
  constructor(private readonly pets: PetsService) {}

  @Public()
  @Get()
  discover(@Query() q: DiscoverPetsQuery) {
    return this.pets.discover(q);
  }

  @Get('mine')
  mine(@CurrentUser() me: Principal) {
    return this.pets.mine(me.userId);
  }

  @Post()
  create(@CurrentUser() me: Principal, @Body() dto: CreatePetDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.pets.create(me.userId, dto, meta);
  }

  /** By UUID or public handle. Private fields are returned to the owner only. */
  @OptionalAuth()
  @Get(':idOrHandle')
  view(@Param('idOrHandle') idOrHandle: string, @CurrentUser() me?: Principal) {
    return this.pets.view(idOrHandle, me?.userId);
  }

  @Patch(':id')
  update(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePetDto) {
    return this.pets.update(me.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    await this.pets.remove(me.userId, id, meta);
    return null;
  }

  @Post(':id/vaccinations')
  addVaccination(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VaccinationDto) {
    return this.pets.addVaccination(me.userId, id, dto);
  }

  @Delete(':id/vaccinations/:vid')
  async removeVaccination(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    await this.pets.removeVaccination(me.userId, id, vid);
    return null;
  }

  @Post(':id/follow')
  @HttpCode(200)
  follow(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.pets.follow(me.userId, id);
  }

  @Delete(':id/follow')
  unfollow(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.pets.unfollow(me.userId, id);
  }
}

@ApiTags('Species')
@Controller('species')
export class SpeciesController {
  constructor(private readonly species: SpeciesService) {}

  @Public()
  @Get()
  list() {
    return this.species.list();
  }

  @Public()
  @Get(':id/breeds')
  breeds(@Param('id', ParseUUIDPipe) id: string) {
    return this.species.breeds(id);
  }
}

@ApiTags('Admin · Pets')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin')
export class AdminPetsController {
  constructor(
    private readonly pets: PetsService,
    private readonly species: SpeciesService,
  ) {}

  @Get('pets')
  @RequirePermissions(PERMISSIONS.PETS_READ_ANY)
  list(@Query() q: AdminPetsQuery) {
    return this.pets.adminList(q);
  }

  @Get('pets/:id')
  @RequirePermissions(PERMISSIONS.PETS_READ_ANY)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.pets.adminDetail(id);
  }

  @Patch('pets/:id/verify')
  @RequirePermissions(PERMISSIONS.PETS_VERIFY)
  verify(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PetVerifyDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.pets.adminVerify(me.userId, id, dto.isVerified, meta);
  }

  @Patch('pets/:id/status')
  @RequirePermissions(PERMISSIONS.PETS_MODERATE)
  setStatus(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PetStatusDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.pets.adminSetStatus(me.userId, id, dto, meta);
  }

  @Get('species')
  @RequirePermissions(PERMISSIONS.SPECIES_MANAGE)
  allSpecies() {
    return this.species.list(true);
  }

  @Post('species')
  @RequirePermissions(PERMISSIONS.SPECIES_MANAGE)
  createSpecies(@CurrentUser() me: Principal, @Body() dto: SpeciesDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.species.createSpecies(me.userId, dto, meta);
  }

  @Patch('species/:id')
  @RequirePermissions(PERMISSIONS.SPECIES_MANAGE)
  updateSpecies(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSpeciesDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.species.updateSpecies(me.userId, id, dto, meta);
  }

  @Get('species/:id/breeds')
  @RequirePermissions(PERMISSIONS.SPECIES_MANAGE)
  allBreeds(@Param('id', ParseUUIDPipe) id: string) {
    return this.species.breeds(id, true);
  }

  @Post('species/:id/breeds')
  @RequirePermissions(PERMISSIONS.SPECIES_MANAGE)
  createBreed(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BreedDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.species.createBreed(me.userId, id, dto, meta);
  }

  @Patch('breeds/:id')
  @RequirePermissions(PERMISSIONS.SPECIES_MANAGE)
  updateBreed(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBreedDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.species.updateBreed(me.userId, id, dto, meta);
  }
}
