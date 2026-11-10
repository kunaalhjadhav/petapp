import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { PLAN_KEY } from './memberships.rules';

export class PurchaseDto {
  @ApiProperty() @IsUUID() planId!: string;
}

export class PlanDto {
  @ApiProperty({ example: 'PLUS' }) @IsString() @Matches(PLAN_KEY, { message: 'Use capitals, digits and underscores, like PLUS.' }) key!: string;
  @ApiProperty() @IsString() @Length(2, 40) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiProperty() @IsInt() @Min(0) @Max(10_000_000) pricePaise!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(366) periodDays!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) rank?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() exclusiveContests?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() premiumChallenges?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() memberDiscounts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(180) priorityDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() badge?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 40) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) pricePaise?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(366) periodDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) rank?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() exclusiveContests?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() premiumChallenges?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() memberDiscounts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(180) priorityDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() badge?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class MembersQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() planId?: string;
  @ApiPropertyOptional({ enum: ['current', 'upcoming', 'ended', 'pending'] }) @IsOptional() @IsIn(['current', 'upcoming', 'ended', 'pending']) state?: string;
  @ApiPropertyOptional({ description: 'Name, phone or email' }) @IsOptional() @IsString() @MaxLength(80) q?: string;
}

export class GrantDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsUUID() planId!: string;
  @ApiProperty({ description: 'Days from now' }) @Type(() => Number) @IsInt() @Min(1) @Max(366) days!: number;
  @ApiProperty({ description: 'Why (kept in the audit log)' }) @IsString() @Length(3, 300) reason!: string;
}

export class RevokeDto {
  @ApiProperty() @IsString() @Length(3, 300) reason!: string;
}
