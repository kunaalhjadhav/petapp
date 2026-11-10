import { Module } from '@nestjs/common';
import { AuthController, AdminAuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { SocialAuthService } from './social.service';
import { StaffPasswordService } from './staff-password.service';
import { StaffMfaService } from './staff-mfa.service';

@Module({
  controllers: [AuthController, AdminAuthController],
  providers: [AuthService, OtpService, TokenService, SocialAuthService, StaffPasswordService, StaffMfaService],
  exports: [TokenService, StaffMfaService],
})
export class AuthModule {}
