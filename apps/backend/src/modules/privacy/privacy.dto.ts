import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { LEGAL_TEMPLATES } from './legal.templates';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const LEGAL_SLUGS = LEGAL_TEMPLATES.map((t) => t.slug);

export class AcceptDto {
  @ApiProperty({ enum: LEGAL_SLUGS }) @IsIn(LEGAL_SLUGS) slug: string;
  @ApiProperty({ description: 'The version that was shown and accepted', example: 1 }) @IsInt() @Min(1) version: number;
}

export class MarketingDto {
  @ApiProperty({ description: 'Offers and news by notification, SMS and email' }) @IsBoolean() granted: boolean;
}

export class UpdateLegalDto {
  @ApiPropertyOptional({ maxLength: 120 }) @Transform(trim) @IsOptional() @IsString() @Length(2, 120) title?: string;
  @ApiPropertyOptional({ description: 'Markdown', maxLength: 100_000 }) @IsOptional() @IsString() @Length(20, 100_000) body?: string;
  @ApiPropertyOptional({ maxLength: 500 }) @Transform(trim) @IsOptional() @IsString() @MaxLength(500) changeSummary?: string;
  @ApiPropertyOptional({ description: 'People must accept this version' }) @IsOptional() @IsBoolean() requiresAcceptance?: boolean;
}

export class NewDraftDto {
  @ApiProperty({ enum: LEGAL_SLUGS }) @IsIn(LEGAL_SLUGS) slug: string;
}

export class PublishLegalDto {
  @ApiPropertyOptional({ description: 'When it takes effect (default: now)' }) @IsOptional() @IsISO8601() effectiveAt?: string;
}

export class PrivacyRequestsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['scheduled', 'deferred', 'erased'] }) @IsOptional() @IsIn(['scheduled', 'deferred', 'erased']) state?: 'scheduled' | 'deferred' | 'erased';
}
