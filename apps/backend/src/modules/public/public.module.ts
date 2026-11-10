import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

/** Data for the public website (Phase 8c). */
@Module({ controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}
