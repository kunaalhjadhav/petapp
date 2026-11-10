import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, OptionalAuth, Public, RequireFeature, RequirePermissions } from '../../common/decorators/auth.decorators';
import { InterestService } from '../recommendations/interest.service';
import type { Principal } from '../../common/principal';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { OrdersService } from './orders.service';
import { VendorsService } from './vendors.service';
import {
  AdminOrdersQuery, AdminProductsQuery, AdminVendorsQuery, BlockProductDto, CartItemDto, CheckoutDto, CommissionDto, CouponDto, PlaceOrderDto, ProductCategoryDto, ProductDto,
  ProductsQuery, ReasonDto, ReturnDecisionDto, ShipDto, StockDto, UpdateCouponDto, UpdateProductDto, UpdateVendorProfileDto, VendorDocumentDto, VendorOrdersQuery,
  UpdateVendorCouponDto, VendorCouponDto, VendorProfileDto, VendorReviewDto,
} from './marketplace.dto';

@ApiTags('Shop')
@ApiBearerAuth()
@RequireFeature('ENABLE_MARKETPLACE')
@Controller()
export class ShopController {
  constructor(
    private readonly orders: OrdersService,
    private readonly interest: InterestService,
  ) {}

  @Public() @Get('product-categories') categories() {
    return this.orders.categories();
  }

  @Public() @Get('products') products(@Query() q: ProductsQuery) {
    return this.orders.products(q);
  }

  @OptionalAuth() @Get('products/:idOrSlug') async product(@Param('idOrSlug') idOrSlug: string, @CurrentUser() me?: Principal) {
    const p = await this.orders.product(idOrSlug);
    this.interest.record(me?.userId, 'PRODUCT_VIEW', p.id, p.category.id);
    return p;
  }

  @Get('cart') cart(@CurrentUser() me: Principal) {
    return this.orders.cart(me.userId);
  }

  @Put('cart/items') setItem(@CurrentUser() me: Principal, @Body() dto: CartItemDto) {
    return this.orders.setCartItem(me.userId, dto.variantId, dto.qty);
  }

  @Delete('cart') clear(@CurrentUser() me: Principal) {
    return this.orders.clearCart(me.userId);
  }

  /** The cart priced with a coupon, without placing anything. */
  @Post('checkout/preview') @HttpCode(200) preview(@CurrentUser() me: Principal, @Body() dto: CheckoutDto) {
    return this.orders.cart(me.userId, dto.couponCode, dto.addressId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('orders') place(@CurrentUser() me: Principal, @Body() dto: PlaceOrderDto) {
    return this.orders.place(me.userId, dto.addressId, dto.couponCode);
  }

  @Get('orders') list(@CurrentUser() me: Principal, @Query() q: PaginationQuery) {
    return this.orders.customerOrders(me.userId, q);
  }

  @Get('orders/:id') one(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.customerOrder(me.userId, id);
  }

  @Post('sub-orders/:id/cancel') @HttpCode(200) cancel(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.orders.customerCancel(me.userId, id, dto.reason);
  }

  @Post('sub-orders/:id/return') @HttpCode(200) requestReturn(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.orders.requestReturn(me.userId, id, dto.reason);
  }
}

/** The seller's side. Onboarding is open to any signed-in user; selling needs approval. */
@ApiTags('Vendor')
@ApiBearerAuth()
@RequireFeature('ENABLE_MARKETPLACE')
@Controller('vendor')
export class VendorController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly shop: OrdersService,
  ) {}

  @Get('profile') me(@CurrentUser() me: Principal) {
    return this.vendors.me(me.userId);
  }

  @Post('profile') create(@CurrentUser() me: Principal, @Body() dto: VendorProfileDto) {
    return this.vendors.create(me.userId, dto);
  }

  @Patch('profile') update(@CurrentUser() me: Principal, @Body() dto: UpdateVendorProfileDto) {
    return this.vendors.update(me.userId, dto);
  }

  @Post('documents') addDoc(@CurrentUser() me: Principal, @Body() dto: VendorDocumentDto) {
    return this.vendors.addDocument(me.userId, dto);
  }

  @Delete('documents/:id') removeDoc(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.removeDocument(me.userId, id);
  }

  @Post('submit') @HttpCode(200) submit(@CurrentUser() me: Principal) {
    return this.vendors.submit(me.userId);
  }

  @Get('products') products(@CurrentUser() me: Principal) {
    return this.vendors.myProducts(me.userId);
  }

  @Post('products') createProduct(@CurrentUser() me: Principal, @Body() dto: ProductDto) {
    return this.vendors.createProduct(me.userId, dto);
  }

  @Patch('products/:id') updateProduct(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.vendors.updateProduct(me.userId, id, dto);
  }

  @Put('variants/:id/stock') stock(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StockDto) {
    return this.vendors.setStock(me.userId, id, dto.stock);
  }

  @Get('orders') orders(@CurrentUser() me: Principal, @Query() q: VendorOrdersQuery) {
    return this.vendors.orders(me.userId, q);
  }

  @Post('orders/:id/pack') @HttpCode(200) pack(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.advance(me.userId, id, 'PACKED');
  }

  @Post('orders/:id/ship') @HttpCode(200) ship(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipDto) {
    return this.vendors.advance(me.userId, id, 'SHIPPED', dto);
  }

  @Post('orders/:id/deliver') @HttpCode(200) deliver(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.advance(me.userId, id, 'DELIVERED');
  }

  @Post('orders/:id/cancel') @HttpCode(200) cancel(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.vendors.vendorCancel(me.userId, id, dto.reason);
  }

  @Post('returns/:id/decide') @HttpCode(200) decide(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnDecisionDto) {
    return this.vendors.decideReturn(me.userId, id, dto.decision, dto.note);
  }

  @Get('earnings') earnings(@CurrentUser() me: Principal) {
    return this.vendors.earnings(me.userId);
  }

  /** Orders to pack and ship, returns to review, stock alerts and sales (today, 7 and 30 days, India time). */
  @Get('dashboard') dashboard(@CurrentUser() me: Principal) {
    return this.vendors.dashboard(me.userId);
  }

  /** The seller's own coupons. They're funded by the seller and apply only to the seller's items. */
  @Get('coupons') coupons(@CurrentUser() me: Principal) {
    return this.shop.vendorCoupons(me.userId);
  }

  @Post('coupons') createCoupon(@CurrentUser() me: Principal, @Body() dto: VendorCouponDto) {
    return this.shop.createVendorCoupon(me.userId, dto);
  }

  @Patch('coupons/:id') updateCoupon(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVendorCouponDto) {
    return this.shop.updateVendorCoupon(me.userId, id, dto);
  }
}

@ApiTags('Admin · Marketplace')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin')
export class AdminMarketplaceController {
  constructor(
    private readonly orders: OrdersService,
    private readonly vendors: VendorsService,
  ) {}

  @Get('vendors') @RequirePermissions(PERMISSIONS.MARKETPLACE_READ) list(@Query() q: AdminVendorsQuery) {
    return this.vendors.adminList(q);
  }

  @Get('vendors/:id') @RequirePermissions(PERMISSIONS.MARKETPLACE_READ) vendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.adminDetail(id);
  }

  @Post('vendors/:id/review') @HttpCode(200) @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE)
  review(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VendorReviewDto) {
    return this.vendors.review(me.userId, id, dto);
  }

  @Patch('vendors/:id/commission') @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE)
  commission(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommissionDto) {
    return this.vendors.setCommission(me.userId, id, dto.commissionBps ?? null);
  }

  @Get('product-categories') @RequirePermissions(PERMISSIONS.MARKETPLACE_READ) categories() {
    return this.orders.adminCategories();
  }

  @Post('product-categories') @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE) createCategory(@CurrentUser() me: Principal, @Body() dto: ProductCategoryDto) {
    return this.orders.saveCategory(me.userId, dto);
  }

  @Patch('product-categories/:id') @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE)
  updateCategory(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductCategoryDto) {
    return this.orders.saveCategory(me.userId, dto, id);
  }

  @Get('products') @RequirePermissions(PERMISSIONS.MARKETPLACE_READ) products(@Query() q: AdminProductsQuery) {
    return this.orders.adminProducts(q);
  }

  @Post('products/:id/block') @HttpCode(200) @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE)
  block(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockProductDto) {
    return this.orders.blockProduct(me.userId, id, dto.blocked, dto.reason);
  }

  @Get('orders') @RequirePermissions(PERMISSIONS.MARKETPLACE_READ) adminOrders(@Query() q: AdminOrdersQuery) {
    return this.orders.adminOrders(q);
  }

  @Get('coupons') @RequirePermissions(PERMISSIONS.MARKETPLACE_READ) coupons() {
    return this.orders.coupons();
  }

  @Post('coupons') @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE) createCoupon(@CurrentUser() me: Principal, @Body() dto: CouponDto) {
    return this.orders.saveCoupon(me.userId, dto);
  }

  @Patch('coupons/:id') @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE)
  updateCoupon(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.orders.saveCoupon(me.userId, dto, id);
  }
}
