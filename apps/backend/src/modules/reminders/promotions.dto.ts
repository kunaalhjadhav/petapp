import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { PROMO_AUDIENCES } from './reminders.rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PromotionDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 60) title!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 200) body!: string;
  @ApiPropertyOptional({ example: '/contest/summer-smiles', description: 'A page in the app it opens' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(160) link?: string;
  @ApiProperty({ enum: PROMO_AUDIENCES }) @IsIn(PROMO_AUDIENCES as unknown as string[]) audience!: (typeof PROMO_AUDIENCES)[number];
  @ApiPropertyOptional({ description: 'For audience CITY' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional({ description: 'When to send; now if left out' }) @IsOptional() @IsDateString() sendAt?: string;
}

export class AudienceQuery {
  @ApiProperty({ enum: PROMO_AUDIENCES }) @IsIn(PROMO_AUDIENCES as unknown as string[]) audience!: (typeof PROMO_AUDIENCES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;
}

export class PromotionsQuery extends PaginationQuery {}
