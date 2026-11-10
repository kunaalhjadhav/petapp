import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { HomeSectionKind } from '../../generated/prisma/enums';
import { DISMISS_TARGETS, type DismissTarget } from './reco.service';

const num = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Where the person is: the phone's position or a chosen city. Without one, their saved address is used. */
export class WhereQuery {
  @ApiPropertyOptional() @Transform(num) @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @Transform(num) @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional({ example: 'Pune' }) @Transform(trim) @IsOptional() @IsString() @MaxLength(80) city?: string;
}

export class RecoQuery extends WhereQuery {
  @ApiPropertyOptional({ default: 10, maximum: 30 }) @Transform(num) @IsOptional() @IsInt() @Min(1) @Max(30) limit?: number;
}

export class ReelsQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) cursor?: string;
  @ApiPropertyOptional({ default: 10, maximum: 30 }) @Transform(num) @IsOptional() @IsInt() @Min(1) @Max(30) limit?: number;
}

export class DismissDto {
  @ApiProperty({ enum: DISMISS_TARGETS }) @IsIn(DISMISS_TARGETS) targetType: DismissTarget;
  @ApiProperty() @IsUUID() targetId: string;
}

export class PersonalisationDto {
  @ApiProperty() @IsBoolean() personalised: boolean;
}

export class CreateHomeSectionDto {
  @ApiProperty({ enum: HomeSectionKind }) @IsEnum(HomeSectionKind) kind: HomeSectionKind;
  @ApiProperty({ example: 'Monsoon picks' }) @Transform(trim) @IsString() @Length(2, 60) title: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(trim) @IsOptional() @IsString() @MaxLength(120) subtitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() startsAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() endsAt?: string | null;
  @ApiPropertyOptional({ type: [String], description: 'Only for people in these cities. Empty = everywhere.' }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(2, 80, { each: true }) cities?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Only for people with a pet of these species. Empty = everyone.' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) speciesIds?: string[];
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 }) @IsOptional() @IsInt() @Min(1) @Max(20) itemLimit?: number;
}

export class UpdateHomeSectionDto {
  @ApiPropertyOptional() @Transform(trim) @IsOptional() @IsString() @Length(2, 60) title?: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(trim) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) subtitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() startsAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() endsAt?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(2, 80, { each: true }) cities?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) speciesIds?: string[];
  @ApiPropertyOptional({ minimum: 1, maximum: 20 }) @IsOptional() @IsInt() @Min(1) @Max(20) itemLimit?: number;
}

export class ReorderSectionsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) ids: string[];
}

export class PinDto {
  @ApiProperty({ example: 'summer-splash', description: 'A link, @handle, slug, coupon code or id' }) @Transform(trim) @IsString() @Length(1, 300) ref: string;
}

export class PreviewQuery extends WhereQuery {}
