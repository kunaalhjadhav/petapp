import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { DiscoverService } from './discover.service';
import { DiscoverController } from './discover.controller';

@Module({ imports: [PostsModule, RecommendationsModule], controllers: [DiscoverController], providers: [DiscoverService] })
export class DiscoverModule {}
