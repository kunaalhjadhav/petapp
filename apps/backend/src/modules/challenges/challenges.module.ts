import { Module } from '@nestjs/common';
import { AdminChallengesController, ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';

@Module({ controllers: [ChallengesController, AdminChallengesController], providers: [ChallengesService], exports: [ChallengesService] })
export class ChallengesModule {}
