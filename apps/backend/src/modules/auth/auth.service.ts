import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { AuthTokens } from '@petapp/types';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../../common/utils/phone';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { AuthProvider, Prisma, User } from '../../generated/prisma/client';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { SocialAuthService, type SocialProfile } from './social.service';
import { RbacService } from '../rbac/rbac.service';
import { StaffMfaService } from './staff-mfa.service';

export interface AuthResult {
  user: PublicUser;
  tokens: AuthTokens;
  isNewUser: boolean;
  /** They had asked to delete their account; signing in during the grace period cancelled that. */
  accountRestored?: boolean;
}

export type PublicUser = Pick<User, 'id' | 'name' | 'phone' | 'email' | 'avatarUrl' | 'status'> & { roles: string[] };

// Pre-computed hash used to equalise timing when an email does not exist.
const DUMMY_HASH = '$2a$12$syI6sWYOXIvV2klJGU.CKe48ZxCo/kSYhzRCS6LMD9fLCiXlH5pk6';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly social: SocialAuthService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly mfa: StaffMfaService,
  ) {}

  normalize(phone: string): string {
    const e164 = normalizePhone(phone, this.config.get('DEFAULT_COUNTRY_CODE'));
    if (!e164) throw new BadRequestException({ message: 'Please enter a valid mobile number.', errors: [{ field: 'phone', message: 'invalid phone' }] });
    return e164;
  }

  async requestOtp(rawPhone: string, meta: RequestMetaInfo) {
    const phone = this.normalize(rawPhone);
    const existing = await this.prisma.user.findUnique({ where: { phone }, select: { status: true } });
    this.assertCanSignIn(existing?.status);
    return this.otp.request(phone, meta.ip);
  }

  async verifyOtp(rawPhone: string, code: string, meta: RequestMetaInfo): Promise<AuthResult> {
    const phone = this.normalize(rawPhone);
    await this.otp.verify(phone, code);

    let user = await this.prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;
    if (!user) {
      user = await this.createUser({ phone, phoneVerifiedAt: new Date() }, 'PHONE', phone, meta);
      isNewUser = true;
    } else {
      this.assertCanSignIn(user.status);
      if (!user.phoneVerifiedAt) user = await this.prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
    }
    return this.finishLogin(user, isNewUser, meta);
  }

  async registerEmail(email: string, password: string, name: string, meta: RequestMetaInfo): Promise<AuthResult> {
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException('An account with this email already exists. Please sign in.');
    }
    const passwordHash = await bcrypt.hash(password, this.config.get('BCRYPT_ROUNDS'));
    const user = await this.createUser({ email, passwordHash, name }, 'EMAIL', email, meta);
    return this.finishLogin(user, true, meta);
  }

  async loginEmail(email: string, password: string, meta: RequestMetaInfo): Promise<AuthResult> {
    const user = await this.verifyPassword(email, password);
    return this.finishLogin(user, false, meta);
  }

  async loginSocial(provider: 'GOOGLE' | 'APPLE', profile: SocialProfile, meta: RequestMetaInfo): Promise<AuthResult> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
      include: { user: true },
    });
    if (identity) {
      this.assertCanSignIn(identity.user.status);
      return this.finishLogin(identity.user, false, meta);
    }
    // Link to an existing account only when the provider has verified the email.
    if (profile.email && profile.emailVerified) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        this.assertCanSignIn(byEmail.status);
        await this.prisma.authIdentity.create({ data: { userId: byEmail.id, provider, providerUserId: profile.providerUserId, email: profile.email } });
        return this.finishLogin(byEmail, false, meta);
      }
    }
    const user = await this.createUser(
      {
        email: profile.email && profile.emailVerified ? profile.email : null,
        emailVerifiedAt: profile.emailVerified ? new Date() : null,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      },
      provider,
      profile.providerUserId,
      meta,
    );
    return this.finishLogin(user, true, meta);
  }

  google(idToken: string, meta: RequestMetaInfo) {
    return this.social.verifyGoogle(idToken).then((p) => this.loginSocial('GOOGLE', p, meta));
  }

  apple(identityToken: string, name: string | undefined, nonce: string, meta: RequestMetaInfo) {
    return this.social.verifyApple(identityToken, name, nonce).then((p) => this.loginSocial('APPLE', p, meta));
  }

  /**
   * Adding a mobile number to an account that signed in with Google or Apple (or changing it): a code goes to the
   * new number, and the number is saved only when that code comes back. A number that already belongs to another
   * account is refused: that person should sign in with it instead.
   */
  async requestPhoneLink(userId: string, rawPhone: string, meta: RequestMetaInfo) {
    const phone = this.normalize(rawPhone);
    await this.assertPhoneFree(userId, phone);
    return this.otp.request(phone, meta.ip, 'VERIFY_PHONE');
  }

  async verifyPhoneLink(userId: string, rawPhone: string, code: string, meta: RequestMetaInfo) {
    const phone = this.normalize(rawPhone);
    await this.assertPhoneFree(userId, phone);
    await this.otp.verify(phone, code, 'VERIFY_PHONE');
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const user = await this.prisma.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });
    await this.audit.log({ actorId: userId, action: 'user.phone_verified', entityType: 'User', entityId: userId, before: { phone: before.phone }, after: { phone }, meta });
    return { phone: user.phone, phoneVerified: true };
  }

  private async assertPhoneFree(userId: string, phone: string) {
    const owner = await this.prisma.user.findUnique({ where: { phone }, select: { id: true, phoneVerifiedAt: true } });
    if (owner && owner.id === userId && owner.phoneVerifiedAt) throw new BadRequestException('This number is already verified on your account.');
    if (owner && owner.id !== userId) {
      throw new ConflictException('This number already has a PetApp account. Sign in with it instead, or use a different number.');
    }
  }

  /** Admin Dashboard sign-in: email + password, staff roles only, ADMIN-audience tokens. */
  async adminLogin(email: string, password: string, meta: RequestMetaInfo): Promise<AuthResult | Awaited<ReturnType<StaffMfaService['challenge']>>> {
    const user = await this.verifyPassword(email, password);
    // The dashboard never restores an account waiting to be deleted; only the person can, in the app.
    this.assertCanSignIn(user.status, false);
    const staff = await this.prisma.userRole.count({ where: { userId: user.id, role: { isStaff: true } } });
    if (!staff) {
      await this.audit.log({ actorId: user.id, action: 'admin.login_denied', entityType: 'User', entityId: user.id, meta });
      throw new ForbiddenException('This account does not have Admin Dashboard access.');
    }
    // Two-factor sign-in (Phase 10a): the password alone doesn't open a session; a code from the app does.
    if (user.mfaEnabledAt) return this.mfa.challenge(user.id);
    return this.adminSession(user.id, meta, 'password');
  }

  /** Second step of a two-factor sign-in. */
  async adminLoginMfa(ticket: string, code: string, meta: RequestMetaInfo): Promise<AuthResult> {
    const { userId, method } = await this.mfa.completeLogin(ticket, code, meta);
    const staff = await this.prisma.userRole.count({ where: { userId, role: { isStaff: true } } });
    if (!staff) throw new ForbiddenException('This account does not have Admin Dashboard access.');
    return this.adminSession(userId, meta, method === 'totp' ? 'password+totp' : 'password+recovery');
  }

  private async adminSession(userId: string, meta: RequestMetaInfo, method: string): Promise<AuthResult> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ actorId: userId, action: 'admin.login', entityType: 'User', entityId: userId, after: { method }, meta });
    const tokens = await this.tokens.issue(userId, 'ADMIN', meta);
    return { user: await this.publicUser(userId), tokens, isNewUser: false };
  }

  refresh(refreshToken: string, meta: RequestMetaInfo) {
    return this.tokens.rotate(refreshToken, meta);
  }

  logout(sessionId: string) {
    return this.tokens.revokeSession(sessionId, 'logout');
  }

  logoutAll(userId: string) {
    return this.tokens.revokeAllForUser(userId, 'logout_all');
  }

  // ── helpers ──

  private async verifyPassword(email: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) throw new UnauthorizedException('Incorrect email or password.');
    this.assertCanSignIn(user.status);
    return user;
  }

  /** In the apps, an account waiting to be deleted can sign in: that cancels the deletion (see finishLogin). */
  private assertCanSignIn(status?: string, allowPendingDeletion = true): void {
    if (!status || status === 'ACTIVE') return;
    if (status === 'PENDING_DELETION' && allowPendingDeletion) return;
    if (status === 'SUSPENDED') throw new ForbiddenException('This account is suspended. Please contact support.');
    throw new ForbiddenException('This account is not available. Please contact support.');
  }

  private async createUser(data: Prisma.UserCreateInput, provider: AuthProvider, providerUserId: string, meta: RequestMetaInfo): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { key: 'CUSTOMER' } });
      const user = await tx.user.create({
        data: {
          ...data,
          roles: { create: { roleId: role.id } },
          identities: { create: { provider, providerUserId, email: typeof data.email === 'string' ? data.email : undefined } },
        },
      });
      await this.audit.log({ actorId: user.id, action: 'user.register', entityType: 'User', entityId: user.id, after: { provider }, meta }, tx);
      return user;
    });
  }

  private async finishLogin(user: User, isNewUser: boolean, meta: RequestMetaInfo): Promise<AuthResult> {
    let accountRestored = false;
    if (user.status === 'PENDING_DELETION') {
      // Only while it's still waiting: the erasure job claims the account the same way, so exactly one of them wins.
      accountRestored = await this.prisma.$transaction(async (tx) => {
        const r = await tx.user.updateMany({ where: { id: user.id, status: 'PENDING_DELETION' }, data: { status: 'ACTIVE', deletedAt: null, statusReason: null } });
        if (r.count) await this.audit.log({ actorId: user.id, action: 'user.delete_cancelled', entityType: 'User', entityId: user.id, meta }, tx);
        return r.count > 0;
      });
      if (!accountRestored) throw new ForbiddenException('This account is not available. Please contact support.');
      await this.rbac.invalidateUser(user.id).catch(() => undefined);
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.tokens.issue(user.id, 'APP', meta);
    return { user: await this.publicUser(user.id), tokens, isNewUser, ...(accountRestored ? { accountRestored } : {}) };
  }

  async passwordChangedAt(userId: string): Promise<Date | null> {
    return (await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordChangedAt: true } })).passwordChangedAt;
  }

  async publicUser(userId: string): Promise<PublicUser> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, phone: true, email: true, avatarUrl: true, status: true, roles: { select: { role: { select: { key: true } } } } },
    });
    const { roles, ...rest } = u;
    return { ...rest, roles: roles.map((r) => r.role.key) };
  }
}
