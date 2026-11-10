import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import {
  BookingStatus,
  PartnerDocKind,
  PartnerStatus,
  ServiceMode,
} from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const num = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

export class CategoryDto {
  @ApiProperty({ example: 'grooming' }) @Matches(/^[a-z][a-z0-9-]{1,40}$/) key: string;
  @ApiProperty({ example: 'Grooming' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional({ description: 'Basis points; 1500 = 15%' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  commissionBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class PartnerProfileDto {
  @ApiProperty({ example: 'Pawfect Grooming Studio' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  businessName: string;
  @ApiProperty({ enum: ['INDIVIDUAL', 'BUSINESS'] }) @IsIn(['INDIVIDUAL', 'BUSINESS']) kind: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) about?: string;
  @ApiProperty({ example: '9812345678' }) @Matches(/^(\+91)?[6-9]\d{9}$/) phone: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) email?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 300) addressLine: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) area?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) city: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) state: string;
  @ApiProperty() @Matches(/^[1-9]\d{5}$/) pincode: string;
  @ApiProperty() @IsLatitude() lat: number;
  @ApiProperty() @IsLongitude() lng: number;
  @ApiPropertyOptional({ description: 'How far you travel for home visits (0 = none)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  homeVisitRadiusKm?: number;
  @ApiPropertyOptional({ description: 'Bookings you can handle at the same time' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  concurrency?: number;
  @ApiPropertyOptional({ enum: [15, 30, 60] })
  @IsOptional()
  @IsIn([15, 30, 60])
  slotStepMin?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5',
  })
  gstin?: string;
  @ApiPropertyOptional({ example: 'ABCDE1234F', description: 'For income-tax TDS; without it a higher rate applies' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{5}\d{4}[A-Z]$/, { message: 'PAN must be 10 characters, e.g. ABCDE1234F' })
  pan?: string;
}
export class UpdatePartnerProfileDto extends PartialType(PartnerProfileDto) {}

export class DocumentDto {
  @ApiProperty({ enum: PartnerDocKind }) @IsEnum(PartnerDocKind) kind: PartnerDocKind;
  @ApiProperty({ description: 'A completed DOCUMENT upload' }) @IsUUID() mediaId: string;
}

export class ServiceDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ example: 'Full groom (small dog)' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiProperty({ example: 60 }) @IsInt() @Min(10) @Max(24 * 60) durationMin: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(240) bufferMin?: number;
  @ApiProperty({ example: 79900 }) @IsInt() @Min(100) @Max(10_000_000) pricePaise: number;
  @ApiProperty({ enum: ServiceMode, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ServiceMode, { each: true })
  modes: ServiceMode[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  speciesIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateServiceDto extends PartialType(ServiceDto) {}

export class HoursItem {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;
  @ApiProperty({ example: 540, description: 'Minutes after midnight, India time' })
  @IsInt()
  @Min(0)
  @Max(1440)
  opensMin: number;
  @ApiProperty({ example: 1080 }) @IsInt() @Min(0) @Max(1440) closesMin: number;
}
export class HoursDto {
  @ApiProperty({ type: [HoursItem] })
  @IsArray()
  @ArrayMaxSize(42)
  @ValidateNested({ each: true })
  @Type(() => HoursItem)
  hours: HoursItem[];
}

export class TimeOffDto {
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class ReasonDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 500) reason?: string;
}

export class PartnerReviewDecisionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE'] })
  @IsIn(['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE'])
  decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE';
  @ApiPropertyOptional({ description: 'Required to reject or suspend; shown to the partner' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason?: string;
  @ApiPropertyOptional({ description: 'Per-document outcome', type: [Object] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocDecision)
  documents?: DocDecision[];
}
export class DocDecision {
  @ApiProperty() @IsUUID() id: string;
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] }) @IsIn(['ACCEPTED', 'REJECTED']) status:
    'ACCEPTED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class CommissionDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Basis points; null = use the category rate',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  commissionBps: number | null;
}

export class AdminPartnersQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: PartnerStatus })
  @IsOptional()
  @IsEnum(PartnerStatus)
  status?: PartnerStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) q?: string;
}

export class NearbyQuery extends PaginationQuery {
  @ApiProperty() @Transform(num) @IsLatitude() lat: number;
  @ApiProperty() @Transform(num) @IsLongitude() lng: number;
  @ApiPropertyOptional()
  @Transform(num)
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  radiusKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ServiceMode }) @IsOptional() @IsEnum(ServiceMode) mode?: ServiceMode;
  @ApiPropertyOptional({ enum: ['distance', 'rating'] })
  @IsOptional()
  @IsIn(['distance', 'rating'])
  sort?: 'distance' | 'rating';
}

export class SlotsQuery {
  @ApiProperty({ example: '2026-10-12', description: 'India calendar date' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;
}

export class AddressDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 300) line: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) landmark?: string;
  @ApiProperty() @IsLatitude() lat: number;
  @ApiProperty() @IsLongitude() lng: number;
}

export class BookingDto {
  @ApiProperty() @IsUUID() serviceId: string;
  @ApiProperty() @IsUUID() petId: string;
  @ApiProperty({ description: 'One of the start times returned by the slots endpoint' })
  @IsDateString()
  startsAt: string;
  @ApiProperty({ enum: ServiceMode }) @IsEnum(ServiceMode) mode: ServiceMode;
  @ApiPropertyOptional({ type: AddressDto, description: 'Required for AT_HOME' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class BookingsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['upcoming', 'past'] })
  @IsOptional()
  @IsIn(['upcoming', 'past'])
  when?: 'upcoming' | 'past';
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}

export class AdminBookingsQuery extends BookingsQuery {
  @ApiPropertyOptional({ description: 'Only this partner’s bookings' }) @IsOptional() @IsUUID() partnerId?: string;
}

export class ReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  comment?: string;
  @ApiPropertyOptional({ type: [String], description: 'Up to 4 finished photo uploads (not private ones)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID('4', { each: true })
  photoIds?: string[];
}


