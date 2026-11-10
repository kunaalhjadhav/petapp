import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { PostsModule } from '../posts/posts.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Module({ imports: [MediaModule, PostsModule, MarketplaceModule], controllers: [SearchController], providers: [SearchService] })
export class SearchModule {}
