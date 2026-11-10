import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsLatitude, IsLongitude, IsObject, IsOptional,
  IsString, IsUrl, Length, Matches, MaxLength,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';
import { Gender, UserStatus } from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional({ example: '1994-05-21' }) @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) avatarUrl?: string;
  @ApiPropertyOptional({ description: 'Free-form UI/notification preferences' }) @IsOptional() @IsObject() preferences?: Record<string, unknown>;
}

export class AddressDto {
  @ApiPropertyOptional({ example: 'Home' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(30) label?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) line1: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) line2?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) locality?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) city: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) state: string;
  @ApiProperty({ example: '400050' }) @Matches(/^[1-9]\d{5}$/, { message: 'pincode must be a 6-digit Indian PIN code' }) pincode: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class UpdateAddressDto extends PartialType(AddressDto) {}

export class AdminUsersQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Name, email or phone' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @ApiPropertyOptional({ example: 'CUSTOMER' }) @IsOptional() @IsString() role?: string;
}

export class SetStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'BLOCKED'] }) @IsIn(['ACTIVE', 'SUSPENDED', 'BLOCKED']) status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason: string;
}

export class SetRolesDto {
  @ApiProperty({ type: [String], example: ['CUSTOMER', 'JUDGE'] }) @IsArray() @ArrayUnique() @IsString({ each: true }) roleKeys: string[];
}
