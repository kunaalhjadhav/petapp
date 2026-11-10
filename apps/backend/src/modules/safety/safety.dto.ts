import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { CaseResolution, CaseStatus, ReportReason, ReportStatus, ReportTarget } from '../../generated/prisma/enums';
import { REPORT_EVIDENCE_MAX } from '../reviews/reviews.rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Everything people can report (spec §59). */
export const REPORTABLE = ['USER', 'PET', 'POST', 'COMMENT', 'PRODUCT', 'SERVICE_PARTNER', 'SERVICE_REVIEW', 'PRODUCT_REVIEW', 'CONTEST_ENTRY', 'CHAT_MESSAGE'] as const satisfies readonly ReportTarget[];

export class CreateReportDto {
  @ApiProperty({ enum: REPORTABLE }) @IsIn(REPORTABLE) targetType: (typeof REPORTABLE)[number];
  @ApiProperty() @IsUUID() targetId: string;
  @ApiProperty({ enum: ReportReason }) @IsEnum(ReportReason) reason: ReportReason;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) details?: string;
  @ApiPropertyOptional({ type: [String], description: `Up to ${REPORT_EVIDENCE_MAX} screenshots or photos, uploaded as private photos` })
  @IsOptional() @IsArray() @ArrayMaxSize(REPORT_EVIDENCE_MAX) @IsUUID('4', { each: true }) evidenceIds?: string[];
}

export class ReportsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ReportStatus }) @IsOptional() @IsEnum(ReportStatus) status?: ReportStatus;
  @ApiPropertyOptional({ enum: ReportTarget }) @IsOptional() @IsEnum(ReportTarget) targetType?: ReportTarget;
  @ApiPropertyOptional({ enum: ReportReason }) @IsOptional() @IsEnum(ReportReason) reason?: ReportReason;
  @ApiPropertyOptional({ description: 'Reported by this person' }) @IsOptional() @IsUUID() reporterId?: string;
  @ApiPropertyOptional({ description: 'Reports about this thing' }) @IsOptional() @IsUUID() targetId?: string;
  @ApiPropertyOptional({ description: 'Words in the details, or the reporter’s name or email' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ description: 'From this day (YYYY-MM-DD, India time)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ description: 'To this day, inclusive' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class CasesQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: CaseStatus, default: 'OPEN' }) @IsOptional() @IsEnum(CaseStatus) status?: CaseStatus;
  @ApiPropertyOptional({ enum: ReportTarget }) @IsOptional() @IsEnum(ReportTarget) targetType?: ReportTarget;
  /** reports = raised by people's reports; ai = flagged by AI moderation (with or without reports). */
  @ApiPropertyOptional({ enum: ['reports', 'ai'] }) @IsOptional() @IsIn(['reports', 'ai']) source?: 'reports' | 'ai';
}

export class ResolveCaseDto {
  @ApiProperty({ enum: CaseResolution }) @IsEnum(CaseResolution) resolution: CaseResolution;
  @ApiProperty({ description: 'Why — saved in the audit log' }) @Transform(trim) @IsString() @Length(3, 1000) note: string;
}
