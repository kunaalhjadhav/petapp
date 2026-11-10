import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { REVIEW_PHOTO_MAX } from './reviews.rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class ProductReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating: number;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) comment?: string;
  @ApiPropertyOptional({ type: [String], description: `Up to ${REVIEW_PHOTO_MAX} finished photo uploads (not private ones)` })
  @IsOptional() @IsArray() @ArrayMaxSize(REVIEW_PHOTO_MAX) @IsUUID('4', { each: true }) photoIds?: string[];
}

export class ReviewsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['recent', 'highest', 'lowest'], default: 'recent' }) @IsOptional() @IsIn(['recent', 'highest', 'lowest']) sort?: 'recent' | 'highest' | 'lowest';
  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'Only reviews with this many stars' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) stars?: number;
  @ApiPropertyOptional({ description: 'Only reviews with photos' }) @IsOptional() @Transform(bool) @IsBoolean() photos?: boolean;
}

export class BusinessReviewsQuery extends ReviewsQuery {
  @ApiPropertyOptional({ description: 'Only reviews you haven’t replied to' }) @IsOptional() @Transform(bool) @IsBoolean() unanswered?: boolean;
}

export class AdminReviewsQuery extends PaginationQuery {
  @ApiProperty({ enum: ['PRODUCT', 'SERVICE'], default: 'PRODUCT' }) @IsOptional() @IsIn(['PRODUCT', 'SERVICE']) kind: 'PRODUCT' | 'SERVICE' = 'PRODUCT';
  @ApiPropertyOptional({ enum: ['VISIBLE', 'HIDDEN'] }) @IsOptional() @IsIn(['VISIBLE', 'HIDDEN']) status?: 'VISIBLE' | 'HIDDEN';
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) stars?: number;
  @ApiPropertyOptional({ description: 'Words in the review, the product, the business or the customer’s name' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() partnerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
}

export class ReviewReplyDto {
  @ApiProperty({ minLength: 2, maxLength: 1000 }) @Transform(trim) @IsString() @Length(2, 1000) reply: string;
}

export class AdminReviewStatusDto {
  @ApiProperty({ enum: ['VISIBLE', 'HIDDEN'] }) @IsIn(['VISIBLE', 'HIDDEN']) status: 'VISIBLE' | 'HIDDEN';
  @ApiPropertyOptional({ description: 'Why — saved in the audit log' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}
