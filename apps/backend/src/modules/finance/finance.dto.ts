import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class PeriodQuery {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'First day (India time). Default: 29 days before `to`' })
  @IsOptional() @Matches(DAY, { message: 'Use a date like 2026-10-01' }) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31', description: 'Last day, included (India time). Default: today' })
  @IsOptional() @Matches(DAY, { message: 'Use a date like 2026-10-31' }) to?: string;
}

export class TrialBalanceQuery {
  @ApiPropertyOptional({ example: '2026-10-31', description: 'Balances at the end of this day (India time). Default: now' })
  @IsOptional() @Matches(DAY, { message: 'Use a date like 2026-10-31' }) asOf?: string;
}

export class AccountsQuery {
  @ApiPropertyOptional({ enum: ['SYSTEM', 'VENDOR', 'PARTNER'] }) @IsOptional() @IsIn(['SYSTEM', 'VENDOR', 'PARTNER']) kind?: 'SYSTEM' | 'VENDOR' | 'PARTNER';
}

export class EntriesQuery extends PaginationQuery {}
export class StatementQuery extends PaginationQuery {}

export class RefundsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'SETTLED_MANUALLY'] })
  @IsOptional() @IsIn(['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'SETTLED_MANUALLY']) status?: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'SETTLED_MANUALLY';
}

export class IssuesQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['open', 'resolved', 'all'], default: 'open' }) @IsOptional() @IsIn(['open', 'resolved', 'all']) state?: 'open' | 'resolved' | 'all';
  @ApiPropertyOptional({ enum: ['ERROR', 'WARNING'] }) @IsOptional() @IsIn(['ERROR', 'WARNING']) severity?: 'ERROR' | 'WARNING';
}

export class ResolveIssueDto {
  @ApiProperty({ example: 'Refunded by bank transfer, UTR 123456' }) @Transform(trim) @IsString() @Length(3, 500) resolution: string;
}

export class SettleRefundDto {
  @ApiProperty({ example: 'NEFT UTR SBIN0001234567', description: 'How the customer was paid (bank transfer reference, cheque number…)' })
  @Transform(trim) @IsString() @Length(4, 200) reference: string;
}

export class TaxReportQuery {
  @ApiProperty({ example: '2026-10', description: 'Month (India time)' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Use a month like 2026-10' }) month: string;
}
