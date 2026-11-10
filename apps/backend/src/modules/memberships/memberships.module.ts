import { Global, Module } from '@nestjs/common';
import { AdminMembershipsController, MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

/** Global: contests, challenges, coupons, bookings and profiles ask it about members-only access and benefits. */
@Global()
@Module({
  controllers: [MembershipsController, AdminMembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
