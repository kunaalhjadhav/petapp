import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';

export class NearbyPetsQuery extends PaginationQuery {
  @ApiProperty() @Type(() => Number) @IsLatitude() lat: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() lng: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) radiusKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() speciesId?: string;
}

export class DiscoverLimitQuery {
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}

export class DiscoverReelsQuery extends DiscoverLimitQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}
