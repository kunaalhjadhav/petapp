import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString,
  IsUUID, Length, MaxLength, Min,
} from 'class-validator';
import { PostType, PostVisibility } from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreatePostDto {
  @ApiProperty({ enum: PostType }) @IsEnum(PostType) type: PostType;
  @ApiProperty({ type: [String], description: 'Media ids from /media/uploads, in display order' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4', { each: true }) mediaIds: string[];
  @ApiPropertyOptional({ maxLength: 2200 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(2200) caption?: string;
  @ApiPropertyOptional({ type: [String], description: 'Pets shown in the post' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID('4', { each: true }) petIds?: string[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 100) locationName?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @ApiPropertyOptional({ enum: PostVisibility }) @IsOptional() @IsEnum(PostVisibility) visibility?: PostVisibility;
}

export class UpdatePostDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2200) caption?: string;
  @ApiPropertyOptional({ enum: PostVisibility }) @IsOptional() @IsEnum(PostVisibility) visibility?: PostVisibility;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) locationName?: string;
}

export class CursorQuery {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' }) @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit = 20;
}

export class CommentDto {
  @ApiProperty({ maxLength: 1000 }) @Transform(trim) @IsString() @Length(1, 1000) body: string;
  @ApiPropertyOptional({ description: 'Reply to this comment' }) @IsOptional() @IsUUID() parentId?: string;
}

export class ViewDto {
  /** The video played to its last frame (Phase 9d: reels completion rate). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() completed?: boolean;
}

export class ShareDto {
  @ApiPropertyOptional({ example: 'whatsapp' }) @IsOptional() @IsString() @MaxLength(30) channel?: string;
}

export class FeedQuery extends CursorQuery {
  @ApiPropertyOptional({ enum: ['all', 'reels'] }) @IsOptional() @IsIn(['all', 'reels']) kind?: 'all' | 'reels';
}
