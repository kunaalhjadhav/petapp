import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ContestsModule } from '../contests/contests.module';
import { ChallengesModule } from '../challenges/challenges.module';
import { RecoService } from './reco.service';
import { HomeService } from './home.service';
import { AdminHomeController, RecommendationsController } from './recommendations.controller';

@Module({
  imports: [PostsModule, MarketplaceModule, ContestsModule, ChallengesModule],
  controllers: [RecommendationsController, AdminHomeController],
  providers: [RecoService, HomeService],
  exports: [RecoService],
})
export class RecommendationsModule {}
