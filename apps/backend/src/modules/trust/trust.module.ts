import { Module } from '@nestjs/common';
import { TrustCoreModule } from './trust-core.module';
import { TrustController } from './trust.controller';

@Module({ imports: [TrustCoreModule], controllers: [TrustController] })
export class TrustModule {}
