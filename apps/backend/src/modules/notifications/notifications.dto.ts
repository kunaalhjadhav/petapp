import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { DevicePlatform } from '../../generated/prisma/enums';

export class MarkReadDto {
  @ApiPropertyOptional({ type: [String], description: 'Omit to mark everything read' })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true }) ids?: string[];
}

export class PreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() push?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() likes?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() comments?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mentions?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() follows?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() posts?: boolean;
  /** Push for new chat messages (Phase 9a). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chat?: boolean;
  /** Booking and contest reminders (Phase 9d). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reminders?: boolean;
  /** New votes on your contest entries (Phase 9d). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() votes?: boolean;
  /** Offers and announcements from PetApp (Phase 9d). Off unless turned on. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() promotions?: boolean;
}

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM registration token' }) @IsString() @Length(20, 4096) token: string;
  @ApiProperty({ enum: DevicePlatform }) @IsEnum(DevicePlatform) platform: DevicePlatform;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) appVersion?: string;
}
