import { Global, Module } from '@nestjs/common';
import { InterestService } from './interest.service';

/** Viewing-history recording, used by the shop, services and contests modules and the worker. */
@Global()
@Module({ providers: [InterestService], exports: [InterestService] })
export class RecoCoreModule {}
