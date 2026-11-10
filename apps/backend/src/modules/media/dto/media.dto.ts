import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MediaKind } from '../../../generated/prisma/enums';

export class CreateUploadDto {
  @ApiProperty({ enum: MediaKind }) @IsEnum(MediaKind) kind: MediaKind;
  @ApiProperty({ example: 'video/mp4' }) @IsString() @MaxLength(100) mimeType: string;
  @ApiProperty({ example: 4_200_000, description: 'Exact size in bytes; part of the upload signature' }) @IsInt() @Min(1) sizeBytes: number;
  /** A photo for a chat or a support ticket: kept private and only shown to the people in the conversation. */
  @ApiPropertyOptional({ description: 'Chat or support attachment (private)' }) @IsOptional() @IsBoolean() private?: boolean;
  /** Phase 9e: the app can send large files in parts and resume after a dropped connection. */
  @ApiPropertyOptional({ description: 'Send in parts (resumable) when the file is large; the answer says which method to use' }) @IsOptional() @IsBoolean() resumable?: boolean;
}

export class PartUrlsDto {
  @ApiProperty({ type: [Number], example: [1, 2, 3], description: 'Part numbers (1-based), at most 50 at a time' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsInt({ each: true }) @Min(1, { each: true }) @Max(10_000, { each: true })
  partNumbers: number[];
}
