import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { SEARCH_TYPES, type SearchType } from './search.rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class SearchTypeParam {
  @ApiProperty({ enum: SEARCH_TYPES }) @IsIn(SEARCH_TYPES) type: SearchType;
}

/** The query and every kind's filters; each kind uses the ones that make sense for it. */
export class SearchQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'What to look for. A leading # looks for reels by hashtag; @ for pets and people by handle.' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ description: 'pets, products' }) @IsOptional() @IsUUID() speciesId?: string;
  @ApiPropertyOptional({ description: 'pets' }) @IsOptional() @IsUUID() breedId?: string;
  @ApiPropertyOptional({ description: 'pets, users, services, partners' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional({ description: 'products, services, partners, contests' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ['AT_CENTER', 'AT_HOME'], description: 'services' }) @IsOptional() @IsIn(['AT_CENTER', 'AT_HOME']) mode?: 'AT_CENTER' | 'AT_HOME';
  @ApiPropertyOptional({ description: 'services, partners: near this point' }) @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) radiusKm?: number;
  @ApiPropertyOptional({ enum: ['open', 'voting', 'past', 'active', 'upcoming'], description: 'contests: open, voting, past; challenges: active, upcoming, past' })
  @IsOptional() @IsIn(['open', 'voting', 'past', 'active', 'upcoming']) when?: string;
  @ApiPropertyOptional({ description: 'products: in stock only' }) @IsOptional() @Transform(bool) @IsBoolean() inStock?: boolean;
}
