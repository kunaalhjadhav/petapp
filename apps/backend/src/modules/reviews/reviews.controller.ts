import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, Public, RequireFeature, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { ReviewsService } from './reviews.service';
import { AdminReviewStatusDto, AdminReviewsQuery, BusinessReviewsQuery, ProductReviewDto, ReviewReplyDto, ReviewsQuery } from './reviews.dto';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public() @RequireFeature('ENABLE_MARKETPLACE') @Get('products/:idOrSlug/reviews')
  productReviews(@Param('idOrSlug') idOrSlug: string, @Query() q: ReviewsQuery) {
    return this.reviews.productReviews(idOrSlug, q);
  }

  @RequireFeature('ENABLE_MARKETPLACE') @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('products/:id/reviews')
  write(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductReviewDto) {
    return this.reviews.writeProductReview(me.userId, id, dto);
  }

  @RequireFeature('ENABLE_MARKETPLACE') @Get('products/:id/reviews/mine')
  mine(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.mine(me.userId, id);
  }

  @Public() @RequireFeature('ENABLE_SERVICES') @Get('service-partners/:id/reviews')
  partnerReviews(@Param('id', ParseUUIDPipe) id: string, @Query() q: ReviewsQuery) {
    return this.reviews.partnerReviews(id, q);
  }
}

/** Sellers and service partners read their reviews and reply once to each. */
@ApiTags('Reviews · Business')
@ApiBearerAuth()
@Controller()
export class BusinessReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @RequireFeature('ENABLE_MARKETPLACE') @Get('vendor/reviews')
  vendorList(@CurrentUser() me: Principal, @Query() q: BusinessReviewsQuery) {
    return this.reviews.businessReviews(me.userId, 'vendor', q);
  }

  @RequireFeature('ENABLE_MARKETPLACE') @Get('vendor/reviews/summary')
  vendorSummary(@CurrentUser() me: Principal) {
    return this.reviews.businessSummary(me.userId, 'vendor');
  }

  @RequireFeature('ENABLE_MARKETPLACE') @Post('vendor/reviews/:id/reply') @HttpCode(200)
  vendorReply(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewReplyDto) {
    return this.reviews.reply(me.userId, 'vendor', id, dto.reply);
  }

  @RequireFeature('ENABLE_SERVICES') @Get('partner/reviews')
  partnerList(@CurrentUser() me: Principal, @Query() q: BusinessReviewsQuery) {
    return this.reviews.businessReviews(me.userId, 'partner', q);
  }

  @RequireFeature('ENABLE_SERVICES') @Get('partner/reviews/summary')
  partnerSummary(@CurrentUser() me: Principal) {
    return this.reviews.businessSummary(me.userId, 'partner');
  }

  @RequireFeature('ENABLE_SERVICES') @Post('partner/reviews/:id/reply') @HttpCode(200)
  partnerReply(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewReplyDto) {
    return this.reviews.reply(me.userId, 'partner', id, dto.reply);
  }
}

@ApiTags('Admin · Reviews')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('reviews') @RequirePermissions(PERMISSIONS.CONTENT_READ)
  list(@Query() q: AdminReviewsQuery) {
    return this.reviews.adminList(q);
  }

  @Post('product-reviews/:id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.CONTENT_MODERATE)
  productStatus(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReviewStatusDto) {
    return this.reviews.setStatus(me.userId, 'PRODUCT', id, dto.status, dto.note);
  }

  @Post('service-reviews/:id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.CONTENT_MODERATE)
  serviceStatus(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReviewStatusDto) {
    return this.reviews.setStatus(me.userId, 'SERVICE', id, dto.status, dto.note);
  }
}
