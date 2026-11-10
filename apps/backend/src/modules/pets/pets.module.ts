import { Module } from '@nestjs/common';
import { PetsService } from './pets.service';
import { SpeciesService } from './species.service';
import { AdminPetsController, PetsController, SpeciesController } from './pets.controller';

@Module({ controllers: [PetsController, SpeciesController, AdminPetsController], providers: [PetsService, SpeciesService], exports: [PetsService] })
export class PetsModule {}
