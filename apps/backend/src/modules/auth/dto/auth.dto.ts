import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RequestOtpDto {
  @ApiProperty({ example: '+919812345678', description: '10-digit Indian mobile or E.164' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;
}

export class VerifyOtpDto extends RequestOtpDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(4, 8)
  code: string;
}

export class EmailRegisterDto {
  @ApiProperty({ example: 'aanya@example.com' })
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 8, description: 'At least 8 characters with a letter and a number' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'password must contain at least one letter and one number' })
  password: string;

  @ApiProperty({ example: 'Aanya Kapoor' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;
}

export class EmailLoginDto {
  @ApiProperty()
  @Transform(lower)
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token from the client SDK' })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}

export class AppleLoginDto {
  @ApiProperty({ description: 'Apple identityToken from Sign in with Apple' })
  @IsString()
  @IsNotEmpty()
  identityToken: string;

  @ApiPropertyOptional({ description: 'Full name — Apple sends it only on first sign-in' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiProperty({ description: 'The random nonce the app generated; its SHA-256 was given to Apple and must match the token' })
  @IsString()
  @Length(16, 128)
  nonce: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken: string;
}

// ── staff passwords (Phase 9e) ──

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(200) currentPassword: string;
  @ApiProperty({ description: 'At least 12 characters; not common, not your name or email' }) @IsString() @MaxLength(200) newPassword: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @Transform(lower) @IsEmail() email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @MaxLength(100) token: string;
  @ApiProperty() @IsString() @MaxLength(200) newPassword: string;
}

export class ResetTokenQuery {
  @ApiProperty() @IsString() @MaxLength(100) token: string;
}

// ── staff two-factor sign-in (Phase 10a) ──

export class MfaLoginDto {
  @ApiProperty({ description: 'From the password step' }) @IsString() @MaxLength(100) mfaTicket: string;
  @ApiProperty({ description: '6-digit code from the authenticator app, or a recovery code' }) @IsString() @MaxLength(40) code: string;
}

export class PasswordConfirmDto {
  @ApiProperty() @IsString() @MaxLength(200) password: string;
}

export class MfaCodeDto {
  @ApiProperty() @IsString() @MaxLength(40) code: string;
}

export class MfaDisableDto {
  @ApiProperty() @IsString() @MaxLength(200) password: string;
  @ApiProperty() @IsString() @MaxLength(40) code: string;
}
