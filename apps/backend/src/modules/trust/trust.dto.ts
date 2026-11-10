import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { ReportTarget } from '../../generated/prisma/enums';
import { MODERATABLE, type ModeratableTarget } from '../../queue/queues';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AssessmentsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['CLEAR', 'FLAGGED', 'ERROR'] }) @IsOptional() @IsIn(['CLEAR', 'FLAGGED', 'ERROR']) verdict?: 'CLEAR' | 'FLAGGED' | 'ERROR';
  @ApiPropertyOptional({ enum: ReportTarget }) @IsOptional() @IsEnum(ReportTarget) targetType?: ReportTarget;
}

export class AssessDto {
  @ApiProperty({ enum: MODERATABLE }) @IsIn(MODERATABLE) targetType: ModeratableTarget;
  @ApiProperty() @IsUUID() targetId: string;
}

export class RiskQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['to_review', 'reviewed', 'all'], default: 'to_review' }) @IsOptional() @IsIn(['to_review', 'reviewed', 'all']) state?: 'to_review' | 'reviewed' | 'all';
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH'] }) @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) level?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class RiskReviewDto {
  @ApiProperty({ example: 'Shared college Wi-Fi; votes look genuine' }) @Transform(trim) @IsString() @Length(3, 500) note: string;
}
