import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, IsUrl, Length, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { ContestStatus, ContestTaskType, ParticipantStatus } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CategoryDto {
  @ApiProperty({ example: 'best-groomed' }) @Matches(/^[a-z][a-z0-9-]{1,40}$/) key: string;
  @ApiProperty({ example: 'Best Groomed Pet' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiProperty({ example: 'BEAUTY', description: 'BEAUTY, TALENT, FUN, PHOTOGRAPHY, SKILLS, CHALLENGE or any admin-defined group' })
  @Matches(/^[A-Z][A-Z_]{1,30}$/) group: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class FinanceDto {
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) prizePoolPct: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) platformFeePct: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) gatewayPct: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) gstOnPlatformFeePct: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) promotionPct: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) refundReservePct: number;
  @ApiProperty({ description: 'Fixed judge fees in paise' }) @IsInt() @Min(0) judgeFeesPaise: number;
}

export class TaskDto {
  @ApiProperty({ enum: ContestTaskType }) @IsEnum(ContestTaskType) type: ContestTaskType;
  @ApiProperty({ example: 'Upload a 30-second grooming video' }) @Transform(trim) @IsString() @Length(3, 120) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() required?: boolean;
}

export class CriterionDto {
  @ApiProperty({ example: 'Creativity' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiProperty({ example: 30 }) @IsInt() @Min(1) @Max(100) weight: number;
}

export class PrizeDto {
  @ApiPropertyOptional({ description: '1, 2, 3 … or omit for a special award' }) @IsOptional() @IsInt() @Min(1) rank?: number;
  @ApiProperty({ example: '1st prize' }) @Transform(trim) @IsString() @Length(2, 80) title: string;
  @ApiProperty({ enum: ['CASH', 'PRODUCT', 'VOUCHER', 'SERVICE', 'SPONSORED'] }) @IsIn(['CASH', 'PRODUCT', 'VOUCHER', 'SERVICE', 'SPONSORED']) kind: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) amountPaise?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class ContestDto {
  @ApiProperty({ example: 'Monsoon Glam Pet 2026' }) @Transform(trim) @IsString() @Length(3, 100) title: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 5000) description: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) bannerUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiProperty({ example: 19900, description: 'Entry fee in paise; 0 = free' }) @IsInt() @Min(0) @Max(10_000_000) feePaise: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minParticipants?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxParticipants?: number;
  @ApiProperty() @IsDateString() registrationOpensAt: string;
  @ApiProperty() @IsDateString() registrationClosesAt: string;
  @ApiProperty() @IsDateString() submissionClosesAt: string;
  @ApiProperty() @IsDateString() votingClosesAt: string;
  @ApiProperty({ example: 40, description: 'Public vote share of the score (0–100); judges get the rest' }) @IsInt() @Min(0) @Max(100) publicWeight: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(50) votesPerUserPerDay?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(365) minAccountAgeDays?: number;
  @ApiPropertyOptional({ default: false, description: 'Only members whose plan includes exclusive contests can enter (needs ENABLE_MEMBERSHIPS)' }) @IsOptional() @IsBoolean() membersOnly?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) eligibleSpeciesIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) rules?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20_000) terms?: string;
  @ApiPropertyOptional({ type: FinanceDto }) @IsOptional() @ValidateNested() @Type(() => FinanceDto) finance?: FinanceDto;
  @ApiPropertyOptional({ type: [TaskDto] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => TaskDto) tasks?: TaskDto[];
  @ApiPropertyOptional({ type: [CriterionDto] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => CriterionDto) criteria?: CriterionDto[];
  @ApiPropertyOptional({ type: [PrizeDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PrizeDto) prizes?: PrizeDto[];
  @ApiPropertyOptional({ type: [String], description: 'User ids with the Judge role' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true }) judgeIds?: string[];
}

/** Same fields and validation as ContestDto, all optional. Nested lists, when sent, replace the existing ones. */
export class UpdateContestDto extends PartialType(ContestDto) {}

export class TransitionDto {
  @ApiProperty({ enum: ContestStatus }) @IsEnum(ContestStatus) to: ContestStatus;
  @ApiPropertyOptional({ description: 'Required to cancel' }) @IsOptional() @Transform(trim) @IsString() @Length(3, 500) reason?: string;
}

export class LegalApprovalDto {
  @ApiProperty({ description: 'Who reviewed it and the reference, e.g. counsel opinion number' }) @Transform(trim) @IsString() @Length(10, 1000) note: string;
}

export class AdminContestsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ContestStatus }) @IsOptional() @IsEnum(ContestStatus) status?: ContestStatus;
}

export class PublicContestsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['upcoming', 'live', 'past'] }) @IsOptional() @IsIn(['upcoming', 'live', 'past']) when?: 'upcoming' | 'live' | 'past';
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
}

export class RegisterDto {
  @ApiProperty() @IsUUID() petId: string;
}

export class SubmissionDto {
  @ApiProperty() @IsUUID() taskId: string;
  @ApiPropertyOptional({ description: 'For POST tasks: one of your published posts' }) @IsOptional() @IsUUID() postId?: string;
  @ApiPropertyOptional({ description: 'For TEXT tasks' }) @IsOptional() @Transform(trim) @IsString() @Length(1, 2000) text?: string;
}

export class ScoresDto {
  @ApiProperty({ type: [Object], example: [{ criterionId: '…', score: 8.5 }] })
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ScoreItem) scores: ScoreItem[];
}
export class ScoreItem {
  @ApiProperty() @IsUUID() criterionId: string;
  @ApiProperty({ minimum: 0, maximum: 10 }) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(10) score: number;
}

export class ParticipantStatusDto {
  @ApiProperty({ enum: ['QUALIFIED', 'FINALIST', 'DISQUALIFIED', 'REGISTERED'] }) @IsIn(['QUALIFIED', 'FINALIST', 'DISQUALIFIED', 'REGISTERED'])
  status: Extract<ParticipantStatus, 'QUALIFIED' | 'FINALIST' | 'DISQUALIFIED' | 'REGISTERED'>;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason: string;
}

export class VoteReviewDto {
  @ApiProperty({ description: 'true = the vote counts; false = it stays excluded' }) @IsBoolean() valid: boolean;
}

export class SpecialAwardDto {
  @ApiProperty() @IsUUID() participantId: string;
}
