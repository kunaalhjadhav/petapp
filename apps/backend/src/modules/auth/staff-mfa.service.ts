import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../../providers/email/email.provider';
import { SecretBox } from '../finance/secret-box';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import type { User } from '../../generated/prisma/client';
import { TokenService } from './token.service';
import { hashRecoveryCode, looksLikeRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from './totp.rules';
import { mfaEmail } from './emails';

const TICKET_TTL = 300;
const SETUP_TTL = 900;
const MAX_TRIES = 5;
const ticketKey = (ticket: string) => `mfa:ticket:${createHash('sha256').update(ticket).digest('hex')}`;

/**
 * Staff two-factor sign-in (Phase 10a): an authenticator app's 6-digit code (TOTP) after the password, with one-time
 * recovery codes for a lost phone. Secrets are sealed at rest; a code works once; a sign-in ticket allows 5 tries
 * in 5 minutes. When `security.requireStaffMfa` is on, staff without it can only set it up.
 */
@Injectable()
export class StaffMfaService {
  private readonly logger = new Logger(StaffMfaService.name);
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly platform: PlatformService,
    private readonly tokens: TokenService,
    config: AppConfig,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {
    this.box = new SecretBox(config.get('MFA_DATA_KEY'), 'MFA_DATA_KEY');
    if (this.box.usingDevKey) this.logger.warn('MFA_DATA_KEY is not set: two-factor secrets use a development key');
  }

  required(): Promise<boolean> {
    return this.platform.getSetting<boolean>('security.requireStaffMfa');
  }

  async status(userId: string) {
    const [u, left, required] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true } }),
      this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
      this.required(),
    ]);
    return { mfaEnabled: !!u.mfaEnabledAt, mfaEnabledAt: u.mfaEnabledAt, recoveryCodesLeft: u.mfaEnabledAt ? left : 0, mfaRequired: required, mfaSetupRequired: required && !u.mfaEnabledAt };
  }

  // ───────────── signing in ─────────────

  /** After a correct password: a short-lived ticket to exchange, with a code, for a session. */
  async challenge(userId: string): Promise<{ mfaRequired: true; mfaTicket: string; expiresInSeconds: number }> {
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.client.set(ticketKey(ticket), JSON.stringify({ userId, tries: 0 }), 'EX', TICKET_TTL);
    return { mfaRequired: true, mfaTicket: ticket, expiresInSeconds: TICKET_TTL };
  }

  /** The second step of signing in. Returns who signed in, and how. */
  async completeLogin(ticket: string, code: string, meta: RequestMetaInfo): Promise<{ userId: string; method: 'totp' | 'recovery' }> {
    const key = ticketKey(ticket);
    const raw = await this.redis.client.get(key);
    if (!raw) throw new UnauthorizedException('This sign-in has expired. Enter your email and password again.');
    const t = JSON.parse(raw) as { userId: string; tries: number };
    const u = await this.prisma.user.findUnique({ where: { id: t.userId } });
    if (!u || u.status !== 'ACTIVE' || !u.mfaEnabledAt || !u.mfaSecret) {
      await this.redis.client.del(key);
      throw new UnauthorizedException('This sign-in has expired. Enter your email and password again.');
    }
    const method = await this.check(u, code);
    if (!method) {
      const tries = t.tries + 1;
      if (tries >= MAX_TRIES) await this.redis.client.del(key);
      else await this.redis.client.set(key, JSON.stringify({ ...t, tries }), 'KEEPTTL');
      await this.audit.log({ actorId: u.id, action: 'admin.mfa_failed', entityType: 'User', entityId: u.id, meta });
      throw new UnauthorizedException(tries >= MAX_TRIES ? 'Too many wrong codes. Enter your email and password again.' : 'That code isn’t right. Check your authenticator app and try again.');
    }
    // A ticket signs in once.
    if (!(await this.redis.client.del(key))) throw new UnauthorizedException('This sign-in has expired. Enter your email and password again.');
    if (method === 'recovery') {
      const left = await this.prisma.mfaRecoveryCode.count({ where: { userId: u.id, usedAt: null } });
      await this.notify(u, 'A recovery code was used to sign in', `A recovery code was used to sign in to the PetApp Admin Dashboard. You have ${left} left. If you lost your phone, set up two-factor sign-in again under Your account.`);
    }
    return { userId: u.id, method };
  }

  // ───────────── setting up and turning off ─────────────

  /** Step 1: a new secret for the authenticator app (after the password, again). Nothing changes until step 2. */
  async setup(userId: string, password: string) {
    const u = await this.withPassword(userId, password);
    if (u.mfaEnabledAt) throw new ConflictException('Two-factor sign-in is already on. Turn it off first to move it to another phone.');
    const secret = newTotpSecret();
    await this.redis.client.set(`mfa:setup:${userId}`, this.box.seal(secret), 'EX', SETUP_TTL);
    return { secret, otpauthUrl: otpauthUrl(secret, u.email ?? u.id), expiresInSeconds: SETUP_TTL };
  }

  /** Step 2: a code from the app proves it's set up. Recovery codes are shown once; other sessions end. */
  async enable(userId: string, sessionId: string | undefined, code: string, meta: RequestMetaInfo) {
    const sealed = await this.redis.client.get(`mfa:setup:${userId}`);
    if (!sealed) throw new BadRequestException('Setting up took too long. Start again.');
    const secret = this.box.open(sealed);
    const step = verifyTotp(secret, code);
    if (step === null) throw new BadRequestException({ message: 'That code isn’t right. Check the time on your phone is set automatically, and try the next code.', errors: [{ field: 'code', message: 'incorrect' }] });
    const codes = newRecoveryCodes();
    const u = await this.prisma.$transaction(async (tx) => {
      const r = await tx.user.updateMany({ where: { id: userId, mfaEnabledAt: null }, data: { mfaSecret: this.box.seal(secret), mfaEnabledAt: new Date(), mfaLastStep: step } });
      if (!r.count) throw new ConflictException('Two-factor sign-in is already on.');
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: c.hash })) });
      await this.audit.log({ actorId: userId, action: 'admin.mfa_enabled', entityType: 'User', entityId: userId, meta }, tx);
      return tx.user.findUniqueOrThrow({ where: { id: userId } });
    });
    await this.redis.client.del(`mfa:setup:${userId}`);
    await this.tokens.revokeAllForUser(userId, 'mfa_enabled', sessionId);
    await this.notify(u, 'Two-factor sign-in is on', 'Two-factor sign-in was turned on for your PetApp Admin account. You’ll need a code from your authenticator app each time you sign in.');
    return { recoveryCodes: codes.map((c) => c.code) };
  }

  /** New recovery codes (the old ones stop working). Needs a current code. */
  async regenerate(userId: string, code: string, meta: RequestMetaInfo) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.mfaEnabledAt) throw new BadRequestException('Two-factor sign-in isn’t on.');
    if ((await this.check(u, code, false)) !== 'totp') throw new BadRequestException('That code isn’t right.');
    const codes = newRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: c.hash })) }),
    ]);
    await this.audit.log({ actorId: userId, action: 'admin.mfa_recovery_codes', entityType: 'User', entityId: userId, meta });
    return { recoveryCodes: codes.map((c) => c.code) };
  }

  /** Turn it off yourself (password and a code), unless staff must use it. */
  async disable(userId: string, password: string, code: string, meta: RequestMetaInfo) {
    const u = await this.withPassword(userId, password);
    if (!u.mfaEnabledAt) throw new BadRequestException('Two-factor sign-in isn’t on.');
    if (await this.required()) throw new ForbiddenException('Two-factor sign-in is required for staff. To move it to a new phone, ask an administrator to reset it, then set it up again.');
    if (!(await this.check(u, code))) throw new BadRequestException('That code isn’t right.');
    await this.clear(u.id);
    await this.audit.log({ actorId: userId, action: 'admin.mfa_disabled', entityType: 'User', entityId: userId, meta });
    await this.notify(u, 'Two-factor sign-in is off', 'Two-factor sign-in was turned off for your PetApp Admin account. If this wasn’t you, contact your PetApp administrator at once.');
    return { mfaEnabled: false };
  }

  /** An administrator resets someone's two-factor sign-in (a lost phone). They're signed out and set it up again. */
  async resetFor(actorId: string, userId: string, meta: RequestMetaInfo) {
    if (actorId === userId) throw new BadRequestException('You can’t reset your own two-factor sign-in. Use a recovery code, or ask another administrator.');
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    const staff = u ? await this.prisma.userRole.count({ where: { userId, role: { isStaff: true } } }) : 0;
    if (!u || !staff) throw new NotFoundException('Staff member not found.');
    if (!u.mfaEnabledAt) throw new BadRequestException('Two-factor sign-in isn’t on for this person.');
    await this.clear(u.id);
    await this.tokens.revokeAllForUser(u.id, 'mfa_reset');
    await this.audit.log({ actorId, action: 'admin.mfa_reset', entityType: 'User', entityId: u.id, meta });
    await this.notify(u, 'Your two-factor sign-in was reset', 'A PetApp administrator reset two-factor sign-in on your PetApp Admin account. Set it up again under Your account after you sign in. If you didn’t ask for this, contact your administrator at once.');
    return { message: `Two-factor sign-in was reset for ${u.email ?? 'this person'}. They’ll set it up again when they next sign in.` };
  }

  // ───────────── helpers ─────────────

  /**
   * A 6-digit code from the app (used once: its time step must be newer than the last one accepted), or, when
   * allowed, an unused recovery code (used up atomically).
   */
  private async check(u: User, code: string, allowRecovery = true): Promise<'totp' | 'recovery' | null> {
    if (u.mfaSecret && /^\s*\d{3}\s?\d{3}\s*$/.test(code)) {
      let secret: string;
      try {
        secret = this.box.open(u.mfaSecret);
      } catch {
        // MFA_DATA_KEY changed: app codes can't be checked, recovery codes still work (and an admin can reset).
        this.logger.error(`two-factor secret for ${u.id} can't be read with the current MFA_DATA_KEY`);
        return null;
      }
      const step = verifyTotp(secret, code);
      if (step === null) return null;
      const r = await this.prisma.user.updateMany({ where: { id: u.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } });
      return r.count ? 'totp' : null;
    }
    if (allowRecovery && looksLikeRecoveryCode(code)) {
      const r = await this.prisma.mfaRecoveryCode.updateMany({ where: { userId: u.id, codeHash: hashRecoveryCode(code), usedAt: null }, data: { usedAt: new Date() } });
      return r.count ? 'recovery' : null;
    }
    return null;
  }

  private async withPassword(userId: string, password: string): Promise<User> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // 400, not 401: the session is fine; only the form is wrong.
    if (!u.passwordHash || !(await bcrypt.compare(password, u.passwordHash))) throw new BadRequestException({ message: 'Your password isn’t right.', errors: [{ field: 'password', message: 'incorrect' }] });
    return u;
  }

  private async clear(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  private async notify(u: { email: string | null; name: string | null }, subject: string, line: string) {
    if (!u.email || !this.email.canSend) return;
    await this.email.send({ to: u.email, ...mfaEmail({ name: u.name, subject, line }) }).catch((e: Error) => this.logger.warn(`two-factor notice not sent: ${e.message}`));
  }
}
