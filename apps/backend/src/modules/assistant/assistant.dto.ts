import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AskDto {
  @ApiProperty({ example: 'Find a groomer near me', maxLength: 1000 }) @Transform(trim) @IsString() @Length(1, 1000) text: string;
  @ApiPropertyOptional({ description: 'Continue this conversation; omit to start a new one' }) @IsOptional() @IsUUID() conversationId?: string;
  @ApiPropertyOptional({ description: 'Where they are, for nearby services (else their saved address)' }) @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
}

export class RateDto {
  @ApiProperty({ enum: ['UP', 'DOWN'] }) @IsIn(['UP', 'DOWN']) rating: 'UP' | 'DOWN';
  @ApiPropertyOptional({ maxLength: 500 }) @Transform(trim) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class FeedbackQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['UP', 'DOWN'] }) @IsOptional() @IsIn(['UP', 'DOWN']) rating?: 'UP' | 'DOWN';
}
