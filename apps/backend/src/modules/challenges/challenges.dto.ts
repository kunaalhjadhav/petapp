import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, IsUrl, Length, Matches, Max, Min } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { ChallengeKind, ChallengeStatus, CheckInProof } from '../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ChallengeDto {
  @ApiProperty({ example: '7 Days Walking Challenge' }) @Transform(trim) @IsString() @Length(3, 100) title: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 3000) description: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) bannerUrl?: string;
  @ApiProperty({ enum: ChallengeKind }) @IsEnum(ChallengeKind) kind: ChallengeKind;
  @ApiPropertyOptional({ description: 'Paise; PAID challenges only' }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) feePaise?: number;
  @ApiPropertyOptional({ description: 'CONTEST_LINKED: only entrants of this contest can join' }) @IsOptional() @IsUUID() contestId?: string;
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiProperty() @IsDateString() endsAt: string;
  @ApiProperty({ example: 7 }) @IsInt() @Min(1) @Max(365) requiredCheckIns: number;
  @ApiProperty({ enum: CheckInProof }) @IsEnum(CheckInProof) proof: CheckInProof;
  @ApiPropertyOptional({ default: 10 }) @IsOptional() @IsInt() @Min(0) @Max(1000) pointsPerCheckIn?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(365) streakBonusEvery?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(10_000) streakBonusPoints?: number;
  @ApiPropertyOptional({ description: 'Awarded on completion' }) @IsOptional() @IsUUID() badgeId?: string;
  @ApiPropertyOptional({ default: false, description: 'A premium challenge: only members whose plan includes them can join (needs ENABLE_MEMBERSHIPS)' }) @IsOptional() @IsBoolean() membersOnly?: boolean;
}
export class UpdateChallengeDto extends PartialType(ChallengeDto) {}

export class ChallengeStatusDto {
  @ApiProperty({ enum: ['PUBLISHED', 'ENDED', 'CANCELLED'] }) @IsIn(['PUBLISHED', 'ENDED', 'CANCELLED']) to: Exclude<ChallengeStatus, 'DRAFT'>;
}

export class BadgeDto {
  @ApiProperty({ example: 'walker-7' }) @Matches(/^[a-z][a-z0-9-]{1,40}$/) key: string;
  @ApiProperty({ example: '7-Day Walker' }) @Transform(trim) @IsString() @Length(2, 60) name: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 300) description: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) iconUrl?: string;
}

export class JoinDto {
  @ApiPropertyOptional({ description: 'The pet doing the challenge' }) @IsOptional() @IsUUID() petId?: string;
}

export class CheckInDto {
  @ApiPropertyOptional({ description: 'POST proof: one of your published posts' }) @IsOptional() @IsUUID() postId?: string;
  @ApiPropertyOptional({ description: 'TEXT proof' }) @IsOptional() @Transform(trim) @IsString() @Length(1, 500) text?: string;
}

export class AdminChallengesQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ChallengeStatus }) @IsOptional() @IsEnum(ChallengeStatus) status?: ChallengeStatus;
}

export class PublicChallengesQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['active', 'upcoming', 'past'] }) @IsOptional() @IsIn(['active', 'upcoming', 'past']) when?: 'active' | 'upcoming' | 'past';
}

export class BoardQuery {
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @IsInt() @Min(1) @Max(100) @Transform(({ value }) => Number(value)) limit = 50;
}
