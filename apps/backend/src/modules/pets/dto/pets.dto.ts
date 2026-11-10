import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional,
  IsString, IsUUID, IsUrl, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';
import { PetGender, PetStatus, PetVisibility } from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const https = { protocols: ['https'], require_protocol: true };

export class CreatePetDto {
  @ApiProperty({ example: 'Bruno' }) @Transform(trim) @IsString() @Length(1, 40) name: string;
  @ApiProperty() @IsUUID() speciesId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() breedId?: string;
  @ApiPropertyOptional({ enum: PetGender }) @IsOptional() @IsEnum(PetGender) gender?: PetGender;
  @ApiPropertyOptional({ example: '2023-08-14' }) @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional({ example: 31.5 }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(2000) weightKg?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) color?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) about?: string;
  @ApiPropertyOptional({ type: [String], example: ['playful', 'gentle'] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 30, { each: true }) personality?: string[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @ApiPropertyOptional({ description: 'Visible to the owner only' }) @IsOptional() @Transform(trim) @Matches(/^[A-Za-z0-9-]{6,23}$/) microchipId?: string;
  @ApiPropertyOptional({ description: 'Visible to the owner only' }) @IsOptional() @IsString() @MaxLength(2000) medicalNotes?: string;
  @ApiPropertyOptional({ enum: PetVisibility }) @IsOptional() @IsEnum(PetVisibility) visibility?: PetVisibility;
  @ApiPropertyOptional({ description: 'Show in “Pets near you” (needs a public profile and a location; only a rough distance is shown)' }) @IsOptional() @IsBoolean() discoverable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUrl(https) avatarUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl(https) coverUrl?: string;
}

export class UpdatePetDto extends PartialType(OmitType(CreatePetDto, ['speciesId'] as const)) {}

export class VaccinationDto {
  @ApiProperty({ example: 'Rabies' }) @Transform(trim) @IsString() @Length(1, 80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() givenOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class DiscoverPetsQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() speciesId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() breedId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) search?: string;
  @ApiPropertyOptional({ enum: ['popular', 'new'], default: 'popular' }) @IsOptional() @IsIn(['popular', 'new']) sort?: 'popular' | 'new';
}

export class AdminPetsQuery extends DiscoverPetsQuery {
  @ApiPropertyOptional({ enum: PetStatus }) @IsOptional() @IsEnum(PetStatus) status?: PetStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) verified?: 'true' | 'false';
}

export class SpeciesDto {
  @ApiProperty({ example: 'guinea-pig' }) @Matches(/^[a-z][a-z0-9-]{1,30}$/) key: string;
  @ApiProperty({ example: 'Guinea pig' }) @Transform(trim) @IsString() @Length(1, 40) name: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateSpeciesDto extends PartialType(OmitType(SpeciesDto, ['key'] as const)) {}

export class BreedDto {
  @ApiProperty({ example: 'Indie' }) @Transform(trim) @IsString() @Length(1, 60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateBreedDto extends PartialType(BreedDto) {}

export class PetStatusDto {
  @ApiProperty({ enum: PetStatus }) @IsEnum(PetStatus) status: PetStatus;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason: string;
}
export class PetVerifyDto {
  @ApiProperty() @IsBoolean() isVerified: boolean;
}
