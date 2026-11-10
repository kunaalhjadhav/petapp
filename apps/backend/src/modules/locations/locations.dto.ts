import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const PIN = /^[1-9][0-9]{5}$/;

// ── public ──
export class CitiesQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
  @ApiPropertyOptional({ description: 'State code ("MH")' }) @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2,3}$/) stateCode?: string;
  @ApiPropertyOptional({ description: 'Only cities where services are live' }) @IsOptional() @Transform(bool) @IsBoolean() servicesLive?: boolean;
}

export class PointQuery {
  @ApiProperty() @Type(() => Number) @IsLatitude() lat: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() lng: number;
}

export class PlaceSearchQuery {
  @ApiProperty({ description: 'A city, area, landmark or 6-digit PIN code (2–80 characters)' })
  @Transform(trim) @IsString() @Length(2, 80) q: string;
}

// ── admin ──
export class AdminCitiesQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2,3}$/) stateCode?: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'live'] }) @IsOptional() @IsIn(['active', 'inactive', 'live']) show?: 'active' | 'inactive' | 'live';
}

export class CityDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiProperty({ description: 'State code ("MH")' }) @Transform(upper) @Matches(/^[A-Z]{2,3}$/) stateCode: string;
  @ApiProperty() @Type(() => Number) @IsLatitude() lat: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() lng: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Service coverage: the services marketplace operates here' }) @IsOptional() @IsBoolean() servicesLive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class UpdateCityDto extends PartialType(CityDto) {}

export class LocalityDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) name: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateLocalityDto extends PartialType(LocalityDto) {}

export class PincodesQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Start of a PIN code, or an area name' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() localityId?: string;
}

export class PincodeDto {
  @ApiProperty() @Transform(trim) @Matches(PIN, { message: 'Use a 6-digit PIN code' }) code: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() localityId?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}
export class UpdatePincodeDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() localityId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsLatitude() lat?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsLongitude() lng?: number | null;
}

export class ImportPlacesDto {
  @ApiProperty({ description: 'CSV: pincode,locality,lat,lng (one per line; a header row is skipped)' }) @IsString() @MaxLength(500_000) csv: string;
  @ApiPropertyOptional({ description: 'Check only; change nothing' }) @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class DeliveryZoneDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: [String], description: 'PIN codes, or prefixes ending in * ("4110*")' })
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsString({ each: true }) @Matches(/^[1-9][0-9]{0,4}\*$|^[1-9][0-9]{5}$/, { each: true, message: 'Use 6-digit PIN codes, or prefixes like 4110*' }) pincodes?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) cityIds?: string[];
  @ApiPropertyOptional({ type: [String], description: 'State codes ("MH")' }) @IsOptional() @IsArray() @ArrayMaxSize(40) @Matches(/^[A-Z]{2,3}$/, { each: true }) stateCodes?: string[];
  @ApiPropertyOptional({ description: 'false = the shop doesn’t deliver here' }) @IsOptional() @IsBoolean() deliverable?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Shipping per parcel here (paise); empty = the standard setting' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_00) shippingFlatPaise?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Free shipping at or above this parcel value (paise); empty = the standard setting' }) @IsOptional() @IsInt() @Min(0) @Max(100_000_00) freeAbovePaise?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(60) minDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(60) maxDays?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string | null;
}
export class UpdateDeliveryZoneDto extends PartialType(DeliveryZoneDto) {}

export class ZoneCheckQuery {
  @ApiProperty() @Transform(trim) @Matches(PIN, { message: 'Use a 6-digit PIN code' }) pincode: string;
}

export class PartnerLocationsQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
  @ApiPropertyOptional({ description: 'Partners near this city' }) @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional({ description: 'Only partners outside every city with services live' }) @IsOptional() @Transform(bool) @IsBoolean() outside?: boolean;
}

export class PartnerLocationDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 200) addressLine?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(trim) @IsString() @MaxLength(100) area?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80) city?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80) state?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PIN) pincode?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsLongitude() lng?: number;
  @ApiPropertyOptional({ description: 'Home-visit radius in km (0 = no home visits)' }) @IsOptional() @IsInt() @Min(0) @Max(100) homeVisitRadiusKm?: number;
  @ApiProperty({ description: 'Why — saved in the audit log' }) @Transform(trim) @IsString() @Length(3, 300) reason: string;
}
