import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, MfaSetupAllowed, Public, RequestMeta, RequirePermissions, type RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { WithMessage } from '../../common/dto/pagination.dto';
import type { Principal } from '../../common/principal';
import { AuthService } from './auth.service';
import { AppleLoginDto, ChangePasswordDto, EmailLoginDto, EmailRegisterDto, ForgotPasswordDto, GoogleLoginDto, MfaCodeDto, MfaDisableDto, MfaLoginDto, PasswordConfirmDto, RefreshDto, RequestOtpDto, ResetPasswordDto, ResetTokenQuery, VerifyOtpDto } from './dto/auth.dto';
import { StaffPasswordService } from './staff-password.service';
import { StaffMfaService } from './staff-mfa.service';

const STRICT = { default: { limit: 5, ttl: 60_000 } };
const LOGIN = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(@Body() dto: RequestOtpDto, @RequestMeta() meta: RequestMetaInfo) {
    return new WithMessage(await this.auth.requestOtp(dto.phone, meta), 'Verification code sent.');
  }

  @Public()
  @Throttle(LOGIN)
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.verifyOtp(dto.phone, dto.code, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('email/register')
  registerEmail(@Body() dto: EmailRegisterDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.registerEmail(dto.email, dto.password, dto.name, meta);
  }

  @Public()
  @Throttle(LOGIN)
  @Post('email/login')
  @HttpCode(200)
  loginEmail(@Body() dto: EmailLoginDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.loginEmail(dto.email, dto.password, meta);
  }

  @Public()
  @Throttle(LOGIN)
  @Post('google')
  @HttpCode(200)
  google(@Body() dto: GoogleLoginDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.google(dto.idToken, meta);
  }

  @Public()
  @Throttle(LOGIN)
  @Post('apple')
  @HttpCode(200)
  apple(@Body() dto: AppleLoginDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.apple(dto.identityToken, dto.name, meta);
  }

  /** Works for both app and admin sessions; the audience is kept from the original session. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() me: Principal) {
    await this.auth.logout(me.sessionId);
    return new WithMessage(null, 'Signed out.');
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentUser() me: Principal) {
    await this.auth.logoutAll(me.userId);
    return new WithMessage(null, 'Signed out from all devices.');
  }
}

@ApiTags('Admin · Auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwords: StaffPasswordService,
    private readonly mfa: StaffMfaService,
  ) {}

  @Public()
  // 10 a minute per address: staff in one office share an IP. Each try costs a bcrypt check.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: EmailLoginDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.adminLogin(dto.email, dto.password, meta);
  }

  @ApiBearerAuth()
  @AdminOnly()
  @MfaSetupAllowed()
  @Get('me')
  async me(@CurrentUser() me: Principal) {
    return {
      ...(await this.auth.publicUser(me.userId)),
      permissions: me.isSuperAdmin ? ['*'] : me.permissions,
      // Phase 9e: null = still the password they were given (the dashboard asks them to change it).
      passwordChangedAt: await this.auth.passwordChangedAt(me.userId),
      emailEnabled: this.passwords.emailEnabled,
      // Phase 10a: two-factor sign-in.
      ...(await this.mfa.status(me.userId)),
    };
  }

  /** Second step of signing in, for staff with two-factor sign-in: the ticket from the password step, and a code. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login/mfa')
  @HttpCode(200)
  loginMfa(@Body() dto: MfaLoginDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.auth.adminLoginMfa(dto.mfaTicket, dto.code, meta);
  }

  /** Two-factor sign-in, step 1: a secret (and QR link) for the authenticator app. Needs your password. */
  @ApiBearerAuth()
  @AdminOnly()
  @MfaSetupAllowed()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentUser() me: Principal, @Body() dto: PasswordConfirmDto) {
    return this.mfa.setup(me.userId, dto.password);
  }

  /** Step 2: a code from the app turns it on. Returns recovery codes (shown once). Other sessions end. */
  @ApiBearerAuth()
  @AdminOnly()
  @MfaSetupAllowed()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@CurrentUser() me: Principal, @Body() dto: MfaCodeDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.mfa.enable(me.userId, me.sessionId, dto.code, meta);
  }

  @ApiBearerAuth()
  @AdminOnly()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  mfaRecoveryCodes(@CurrentUser() me: Principal, @Body() dto: MfaCodeDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.mfa.regenerate(me.userId, dto.code, meta);
  }

  @ApiBearerAuth()
  @AdminOnly()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('mfa/disable')
  @HttpCode(200)
  mfaDisable(@CurrentUser() me: Principal, @Body() dto: MfaDisableDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.mfa.disable(me.userId, dto.password, dto.code, meta);
  }

  /** An administrator resets someone's two-factor sign-in (a lost phone). */
  @ApiBearerAuth()
  @AdminOnly()
  @RequirePermissions(PERMISSIONS.USERS_ROLES_ASSIGN)
  @Post('staff/:id/mfa-reset')
  @HttpCode(200)
  async mfaReset(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    const r = await this.mfa.resetFor(me.userId, id, meta);
    return new WithMessage(r, r.message);
  }

  /** Change your own password (the current one is needed). Your other sessions end. */
  @ApiBearerAuth()
  @AdminOnly()
  @MfaSetupAllowed()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password')
  @HttpCode(200)
  async changePassword(@CurrentUser() me: Principal, @Body() dto: ChangePasswordDto, @RequestMeta() meta: RequestMetaInfo) {
    await this.passwords.change(me.userId, me.sessionId, dto.currentPassword, dto.newPassword, meta);
    return new WithMessage({ changed: true }, 'Password changed. You’ve been signed out everywhere else.');
  }

  /** Forgot password: emails a link if the address is a staff account. Same answer either way. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(200)
  async forgot(@Body() dto: ForgotPasswordDto, @RequestMeta() meta: RequestMetaInfo) {
    const r = await this.passwords.forgot(dto.email, meta);
    return new WithMessage(r, r.message);
  }

  /** Whether a reset link still works. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('password/reset')
  checkReset(@Query() q: ResetTokenQuery) {
    return this.passwords.check(q.token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body() dto: ResetPasswordDto, @RequestMeta() meta: RequestMetaInfo) {
    const r = await this.passwords.reset(dto.token, dto.newPassword, meta);
    return new WithMessage(r, 'Password set. Sign in with it now.');
  }

  /** An administrator emails a staff member a link to set a new password. */
  @ApiBearerAuth()
  @AdminOnly()
  @RequirePermissions(PERMISSIONS.USERS_ROLES_ASSIGN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('staff/:id/password-reset')
  @HttpCode(200)
  async sendReset(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @RequestMeta() meta: RequestMetaInfo) {
    const r = await this.passwords.sendFor(me.userId, id, meta);
    return new WithMessage(r, r.message);
  }

  @ApiBearerAuth()
  @AdminOnly()
  @MfaSetupAllowed()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() me: Principal) {
    await this.auth.logout(me.sessionId);
    return new WithMessage(null, 'Signed out.');
  }
}
