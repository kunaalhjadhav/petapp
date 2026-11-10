import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { CouponKind, PartnerDocKind, ProductStatus, SubOrderStatus, VendorStatus } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

// ── vendor onboarding ──

export class VendorProfileDto {
  @ApiProperty({ example: 'Happy Tails Pet Store' }) @Transform(trim) @IsString() @Length(2, 100) businessName: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(150) legalName?: string;
  @ApiPropertyOptional({ example: '27ABCDE1234F1Z5' })
  @IsOptional() @Transform(upper)
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, { message: 'GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5' })
  gstin?: string;
  @ApiPropertyOptional({ example: 'ABCDE1234F', description: 'For income-tax TDS; without it a higher rate applies' })
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{5}\d{4}[A-Z]$/, { message: 'PAN must be 10 characters, e.g. ABCDE1234F' })
  pan?: string;
  @ApiProperty({ example: '9812345678' }) @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'Enter a 10-digit Indian mobile number' }) phone: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) email?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) addressLine: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 60) city: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 60) state: string;
  @ApiProperty() @Matches(/^[1-9]\d{5}$/, { message: 'PIN code must be 6 digits' }) pincode: string;
}
export class UpdateVendorProfileDto extends PartialType(VendorProfileDto) {}

export class VendorDocumentDto {
  @ApiProperty({ enum: PartnerDocKind }) @IsEnum(PartnerDocKind) kind: PartnerDocKind;
  @ApiProperty({ description: 'A completed DOCUMENT upload' }) @IsUUID() mediaId: string;
}

export class DocDecision {
  @ApiProperty() @IsUUID() id: string;
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] }) @IsIn(['ACCEPTED', 'REJECTED']) status: 'ACCEPTED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class VendorReviewDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE'] }) @IsIn(['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE']) decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE';
  @ApiPropertyOptional({ description: 'Required to reject or suspend; the vendor sees it' }) @IsOptional() @Transform(trim) @IsString() @Length(3, 500) reason?: string;
  @ApiPropertyOptional({ type: [DocDecision] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DocDecision) documents?: DocDecision[];
}

export class AdminVendorsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: VendorStatus }) @IsOptional() @IsEnum(VendorStatus) status?: VendorStatus;
}

export class CommissionDto {
  @ApiPropertyOptional({ description: 'Basis points (1500 = 15%); null returns the vendor to category rates', nullable: true })
  @IsOptional() @IsInt() @Min(0) @Max(5000) commissionBps: number | null;
}

// ── catalogue ──

export class ProductCategoryDto {
  @ApiProperty({ example: 'dog-food' }) @Matches(/^[a-z][a-z0-9-]{1,40}$/) key: string;
  @ApiProperty({ example: 'Dog food' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
  @ApiProperty({ example: 1000, description: 'Standard commission, basis points' }) @IsInt() @Min(0) @Max(5000) commissionBps: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class VariantDto {
  @ApiProperty({ example: 'RC-MINI-3KG' }) @Transform(upper) @Matches(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, { message: 'SKU: letters, numbers, dot, dash or underscore (max 40)' }) sku: string;
  @ApiProperty({ example: '3 kg' }) @Transform(trim) @IsString() @Length(1, 60) title: string;
  @ApiProperty({ example: 189900 }) @IsInt() @Min(100) @Max(100_000_000) mrpPaise: number;
  @ApiProperty({ example: 169900, description: 'Selling price, GST included' }) @IsInt() @Min(100) @Max(100_000_000) pricePaise: number;
  @ApiProperty({ example: 1800, description: 'GST included in the price, basis points' }) @IsIn([0, 500, 1200, 1800, 2800]) gstRateBps: number;
  @ApiProperty({ example: 25, description: 'Opening stock for a new variant. Ignored for an existing one when updating a product: use PUT /vendor/variants/{id}/stock' }) @IsInt() @Min(0) @Max(100_000) stock: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) weightGrams?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ProductDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ example: 'Royal Canin Mini Adult' }) @Transform(trim) @IsString() @Length(3, 150) title: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 5000) description: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) brand?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) speciesIds?: string[];
  @ApiPropertyOptional({ type: [String], description: 'READY image uploads, in display order' }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('4', { each: true }) imageIds?: string[];
  @ApiProperty({ type: [VariantDto] }) @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => VariantDto) variants: VariantDto[];
}
export class UpdateProductDto extends PartialType(ProductDto) {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

export class StockDto {
  @ApiProperty() @IsInt() @Min(0) @Max(100_000) stock: number;
}

export class ProductsQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() speciesId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;
  @ApiPropertyOptional({ enum: ['relevance', 'price_asc', 'price_desc', 'newest', 'rating'] }) @IsOptional() @IsIn(['relevance', 'price_asc', 'price_desc', 'newest', 'rating']) sort?: string;
}

export class AdminProductsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ProductStatus }) @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) q?: string;
}

export class BlockProductDto {
  @ApiProperty() @IsBoolean() blocked: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 500) reason?: string;
}

// ── cart, checkout, orders ──

export class CartItemDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty({ description: '0 removes the item' }) @IsInt() @Min(0) @Max(100) qty: number;
}

export class CheckoutDto {
  @ApiPropertyOptional() @IsOptional() @Transform(upper) @IsString() @MaxLength(30) couponCode?: string;
  /** Phase 9c: price shipping and check delivery for this address (delivery zones). */
  @ApiPropertyOptional({ description: 'One of your saved addresses: shipping and delivery time for it' }) @IsOptional() @IsUUID() addressId?: string;
}

export class PlaceOrderDto extends CheckoutDto {
  @ApiProperty({ description: 'One of your saved addresses' }) @IsUUID() declare addressId: string;
}

export class ReasonDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason: string;
}

export class ShipDto {
  @ApiProperty({ example: 'Delhivery' }) @Transform(trim) @IsString() @Length(2, 60) courier: string;
  @ApiProperty({ example: 'DL123456789IN' }) @Transform(trim) @IsString() @Length(4, 60) trackingNumber: string;
}

export class ReturnDecisionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT', 'RECEIVED'] }) @IsIn(['APPROVE', 'REJECT', 'RECEIVED']) decision: 'APPROVE' | 'REJECT' | 'RECEIVED';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 500) note?: string;
}

export class VendorOrdersQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: SubOrderStatus }) @IsOptional() @IsEnum(SubOrderStatus) status?: SubOrderStatus;
}

export class AdminOrdersQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: SubOrderStatus }) @IsOptional() @IsEnum(SubOrderStatus) status?: SubOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;
}

// ── coupons ──

export class CouponDto {
  @ApiProperty({ example: 'PETS10' }) @Transform(upper) @Matches(/^[A-Z0-9]{3,20}$/, { message: 'Code: 3–20 letters or numbers' }) code: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) description?: string;
  @ApiProperty({ enum: CouponKind }) @IsEnum(CouponKind) kind: CouponKind;
  @ApiProperty({ description: 'PERCENT: basis points (1000 = 10%); FLAT: paise' }) @IsInt() @Min(1) @Max(10_000_000) value: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxDiscountPaise?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minOrderPaise?: number;
  @ApiPropertyOptional({ description: 'Vendor-funded: applies only to this vendor’s items' }) @IsOptional() @IsUUID() vendorId?: string;
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usageLimit?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(100) perUserLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ default: false, description: 'Only members whose plan includes member discounts can use it (needs ENABLE_MEMBERSHIPS)' }) @IsOptional() @IsBoolean() membersOnly?: boolean;
}
export class UpdateCouponDto extends PartialType(CouponDto) {}

/** A seller's own coupon: always funded by, and limited to, that seller. */
export class VendorCouponDto extends OmitType(CouponDto, ['vendorId'] as const) {}
export class UpdateVendorCouponDto extends PartialType(VendorCouponDto) {}
