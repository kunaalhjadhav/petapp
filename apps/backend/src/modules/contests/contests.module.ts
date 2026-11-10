import { Module } from '@nestjs/common';
import { AdminContestsController, ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';

@Module({ controllers: [ContestsController, AdminContestsController], providers: [ContestsService], exports: [ContestsService] })
export class ContestsModule {}
