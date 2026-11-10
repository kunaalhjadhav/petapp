import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import {
  AdminOnly,
  CurrentUser,
  OptionalAuth,
  Public,
  RequireFeature,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { BookingsService } from './bookings.service';
import { InterestService } from '../recommendations/interest.service';

/** The category most of a partner's services are in (for viewing history). */
const mainCategory = (services: Array<{ category: { id: string } }>) => {
  const n = new Map<string, number>();
  for (const s of services) n.set(s.category.id, (n.get(s.category.id) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
import { PartnersService } from './partners.service';
import {
  AdminPartnersQuery,
  BookingDto,
  BookingsQuery,
  AdminBookingsQuery,
  CategoryDto,
  CommissionDto,
  DocumentDto,
  HoursDto,
  NearbyQuery,
  PartnerProfileDto,
  PartnerReviewDecisionDto,
  ReasonDto,
  ReviewDto,
  ServiceDto,
  SlotsQuery,
  TimeOffDto,
  UpdatePartnerProfileDto,
  UpdateServiceDto,
} from './services.dto';

/** Customers: find, book, pay, cancel and review. */
@ApiTags('Services')
@ApiBearerAuth()
@RequireFeature('ENABLE_SERVICES')
@Controller()
export class ServicesController {
  constructor(
    private readonly partners: PartnersService,
    private readonly bookings: BookingsService,
    private readonly interest: InterestService,
  ) {}

  @Public()
  @Get('service-categories')
  categories() {
    return this.partners.categories();
  }

  @Public()
  @Get('services/nearby')
  nearby(@Query() q: NearbyQuery) {
    return this.bookings.nearby(q);
  }

  @OptionalAuth()
  @Get('service-partners/:idOrSlug')
  async partner(@Param('idOrSlug') idOrSlug: string, @CurrentUser() me?: Principal) {
    const p = await this.bookings.partnerPage(idOrSlug);
    this.interest.record(me?.userId, 'SERVICE_VIEW', p.id, mainCategory(p.services));
    return p;
  }

  /** Signed in, a member with priority booking sees further ahead (spec §40). */
  @OptionalAuth()
  @Get('partner-services/:id/slots')
  slots(@Param('id', ParseUUIDPipe) id: string, @Query() q: SlotsQuery, @CurrentUser() me?: Principal) {
    return this.bookings.slots(id, q.date, me?.userId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('bookings')
  book(@CurrentUser() me: Principal, @Body() dto: BookingDto) {
    return this.bookings.book(me.userId, dto);
  }

  @Get('bookings')
  mine(@CurrentUser() me: Principal, @Query() q: BookingsQuery) {
    return this.bookings.listMine(me.userId, q);
  }

  @Get('bookings/:id')
  one(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.view(id, me.userId);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.bookings.cancel(me.userId, id, 'CUSTOMER', dto.reason);
  }

  @Post('bookings/:id/review')
  review(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.bookings.review(me.userId, id, dto);
  }
}

/** Service partners manage their own business (the partner app). */
@ApiTags('Partner')
@ApiBearerAuth()
@RequireFeature('ENABLE_SERVICES')
@Controller('partner')
export class PartnerController {
  constructor(
    private readonly partners: PartnersService,
    private readonly bookings: BookingsService,
  ) {}

  @Get('profile') me(@CurrentUser() me: Principal) {
    return this.partners.me(me.userId);
  }
  @Post('profile') create(@CurrentUser() me: Principal, @Body() dto: PartnerProfileDto) {
    return this.partners.createProfile(me.userId, dto);
  }
  @Patch('profile') update(@CurrentUser() me: Principal, @Body() dto: UpdatePartnerProfileDto) {
    return this.partners.updateProfile(me.userId, dto);
  }
  @Post('documents') addDoc(@CurrentUser() me: Principal, @Body() dto: DocumentDto) {
    return this.partners.addDocument(me.userId, dto);
  }
  @Delete('documents/:id') removeDoc(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.partners.removeDocument(me.userId, id);
  }
  @Post('submit') @HttpCode(200) submit(@CurrentUser() me: Principal) {
    return this.partners.submit(me.userId);
  }
  @Post('services') addService(@CurrentUser() me: Principal, @Body() dto: ServiceDto) {
    return this.partners.addService(me.userId, dto);
  }
  @Patch('services/:id') updateService(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.partners.updateService(me.userId, id, dto);
  }
  @Put('hours') hours(@CurrentUser() me: Principal, @Body() dto: HoursDto) {
    return this.partners.setHours(me.userId, dto.hours);
  }
  @Post('time-off') timeOff(@CurrentUser() me: Principal, @Body() dto: TimeOffDto) {
    return this.partners.addTimeOff(me.userId, dto);
  }
  @Delete('time-off/:id') removeTimeOff(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.partners.removeTimeOff(me.userId, id);
  }

  /** Completed earnings (by month, India time) and what confirmed bookings will add. */
  @Get('earnings') earnings(@CurrentUser() me: Principal) {
    return this.partners.earnings(me.userId);
  }
  @Get('bookings') bookingsList(@CurrentUser() me: Principal, @Query() q: BookingsQuery) {
    return this.bookings.listForPartner(me.userId, q);
  }
  @Post('bookings/:id/start') @HttpCode(200) start(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookings.partnerUpdate(me.userId, id, 'IN_PROGRESS');
  }
  @Post('bookings/:id/complete') @HttpCode(200) complete(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookings.partnerUpdate(me.userId, id, 'COMPLETED');
  }
  @Post('bookings/:id/no-show') @HttpCode(200) noShow(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookings.partnerUpdate(me.userId, id, 'NO_SHOW');
  }
  @Post('bookings/:id/cancel') @HttpCode(200) cancel(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.bookings.cancel(me.userId, id, 'PARTNER', dto.reason);
  }
}

@ApiTags('Admin · Services')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin')
export class AdminServicesController {
  constructor(
    private readonly partners: PartnersService,
    private readonly bookings: BookingsService,
  ) {}

  @Get('service-categories')
  @RequirePermissions(PERMISSIONS.PARTNERS_READ)
  categories() {
    return this.partners.categories(true);
  }

  @Post('service-categories')
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  createCategory(@CurrentUser() me: Principal, @Body() dto: CategoryDto) {
    return this.partners.saveCategory(me.userId, dto);
  }

  @Patch('service-categories/:id')
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  updateCategory(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CategoryDto,
  ) {
    return this.partners.saveCategory(me.userId, dto, id);
  }

  @Get('partners')
  @RequirePermissions(PERMISSIONS.PARTNERS_READ)
  list(@Query() q: AdminPartnersQuery) {
    return this.partners.adminList(q);
  }

  @Get('partners/:id')
  @RequirePermissions(PERMISSIONS.PARTNERS_READ)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.partners.adminDetail(id);
  }

  @Post('partners/:id/review')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PARTNERS_REVIEW)
  review(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PartnerReviewDecisionDto,
  ) {
    return this.partners.review(me.userId, id, dto);
  }

  @Patch('partners/:id/commission')
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  commission(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommissionDto,
  ) {
    return this.partners.setCommission(me.userId, id, dto.commissionBps ?? null);
  }

  @Get('bookings')
  @RequirePermissions(PERMISSIONS.PARTNERS_READ)
  bookingsList(@Query() q: AdminBookingsQuery) {
    return this.bookings.adminList(q);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  cancel(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.bookings.cancel(me.userId, id, 'ADMIN', dto.reason);
  }
}
