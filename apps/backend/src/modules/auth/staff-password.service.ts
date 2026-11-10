import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../../providers/email/email.provider';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { TokenService } from './token.service';
import { hashResetToken, newResetToken, passwordProblem, RESET_TOKEN } from './password.rules';
import { changedEmail, resetEmail } from './emails';

const GENERIC = (minutes: number) => `If that email belongs to a staff account, we’ve sent it a link to set a new password. The link works for ${minutes} minutes.`;
const RESETS_PER_HOUR = 3;

/**
 * Staff passwords (Phase 9e): change your own (with the current one), reset a forgotten one through a link sent by
 * email, and an administrator sending someone that link. Links are single-use, short-lived and stored only as a
 * hash. Setting a password signs the account out everywhere else and emails a notice.
 */
@Injectable()
export class StaffPasswordService {
  private readonly logger = new Logger(StaffPasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  get emailEnabled(): boolean {
    return this.email.canSend;
  }

  private async isStaff(userId: string) {
    return (await this.prisma.userRole.count({ where: { userId, role: { isStaff: true } } })) > 0;
  }

  private problem(password: string, u: { email: string | null; name: string | null }) {
    const p = passwordProblem(password, u);
    if (p) throw new BadRequestException({ message: p, errors: [{ field: 'newPassword', message: p }] });
  }

  /** Change your own password. Other sessions end; this one stays signed in. */
  async change(userId: string, sessionId: string | undefined, current: string, next: string, meta: RequestMetaInfo) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.passwordHash || !(await bcrypt.compare(current, u.passwordHash))) {
      await this.audit.log({ actorId: userId, action: 'admin.password_change_failed', entityType: 'User', entityId: userId, meta });
      // 400, not 401: the session is fine; only the form is wrong (a 401 would sign the dashboard out).
      throw new BadRequestException({ message: 'Your current password isn’t right.', errors: [{ field: 'currentPassword', message: 'incorrect' }] });
    }
    this.problem(next, u);
    if (await bcrypt.compare(next, u.passwordHash)) throw new BadRequestException('Choose a password you haven’t used here before.');
    await this.setPassword(u.id, next);
    await this.tokens.revokeAllForUser(u.id, 'password_changed', sessionId);
    await this.audit.log({ actorId: userId, action: 'admin.password_change', entityType: 'User', entityId: userId, meta });
    await this.notify(u.email, () => changedEmail({ name: u.name, at: new Date(), how: 'changed' }));
    return { changed: true };
  }

  /** "Forgot password": always the same answer, whether or not the email is a staff account. */
  async forgot(rawEmail: string, meta: RequestMetaInfo) {
    const minutes = this.config.get('PASSWORD_RESET_TTL_MINUTES');
    if (!this.email.canSend) throw new ServiceUnavailableException('Password reset by email isn’t set up. Ask a PetApp administrator to help you sign in.');
    const email = rawEmail.trim().toLowerCase();
    // At most a few links an hour per address, whoever asks: stops mail-bombing a colleague.
    const key = `pwreset:${email}`;
    const n = await this.redis.client.incr(key);
    if (n === 1) await this.redis.client.expire(key, 3600);
    if (n <= RESETS_PER_HOUR) {
      const u = await this.prisma.user.findUnique({ where: { email } });
      if (u && u.status === 'ACTIVE' && u.passwordHash !== null && (await this.isStaff(u.id))) {
        // Sent in the background: the answer takes as long whether or not the address is a staff account.
        void this.sendLink(u, 'SELF', meta)
          .then(() => this.audit.log({ actorId: u.id, action: 'admin.password_reset_requested', entityType: 'User', entityId: u.id, meta }))
          .catch((e: Error) => this.logger.error(`reset link not sent: ${e.message}`));
      }
    }
    return { message: GENERIC(minutes) };
  }

  /** An administrator sends a staff member a reset link (to the member's own email; the admin never sees it). */
  async sendFor(actorId: string, userId: string, meta: RequestMetaInfo) {
    if (!this.email.canSend) throw new ServiceUnavailableException('Email isn’t set up (EMAIL_PROVIDER), so no link can be sent.');
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !(await this.isStaff(u.id))) throw new NotFoundException('Staff member not found.');
    if (!u.email) throw new BadRequestException('This staff member has no email address.');
    if (u.status !== 'ACTIVE') throw new ForbiddenException('This account isn’t active.');
    await this.sendLink(u, 'STAFF', meta);
    await this.audit.log({ actorId, action: 'admin.password_reset_sent', entityType: 'User', entityId: u.id, meta });
    return { message: `A link to set a new password was sent to ${u.email}.` };
  }

  /** Whether a link still works, so the page can say so before someone types a new password. */
  async check(token: string) {
    const r = await this.find(token);
    return { valid: !!r, email: r?.user.email ? maskEmail(r.user.email) : null };
  }

  /** Sets a new password from a link. The link is used up; every session ends. */
  async reset(token: string, next: string, meta: RequestMetaInfo) {
    const r = await this.find(token);
    if (!r) throw new BadRequestException('This link has expired or was already used. Ask for a new one.');
    this.problem(next, r.user);
    const claimed = await this.prisma.passwordReset.updateMany({ where: { id: r.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new BadRequestException('This link has expired or was already used. Ask for a new one.');
    await this.setPassword(r.userId, next);
    await this.prisma.passwordReset.updateMany({ where: { userId: r.userId, usedAt: null }, data: { usedAt: new Date() } });
    await this.tokens.revokeAllForUser(r.userId, 'password_reset');
    await this.audit.log({ actorId: r.userId, action: 'admin.password_reset', entityType: 'User', entityId: r.userId, after: { requestedBy: r.requestedBy }, meta });
    await this.notify(r.user.email, () => changedEmail({ name: r.user.name, at: new Date(), how: 'reset' }));
    return { reset: true, email: r.user.email };
  }

  // ── helpers ──

  private async find(token: string) {
    if (!RESET_TOKEN.test(token)) return null;
    const r = await this.prisma.passwordReset.findUnique({ where: { tokenHash: hashResetToken(token) }, include: { user: true } });
    if (!r || r.usedAt || r.expiresAt <= new Date() || r.user.status !== 'ACTIVE' || !(await this.isStaff(r.userId))) return null;
    return r;
  }

  private async sendLink(u: { id: string; email: string | null; name: string | null }, by: 'SELF' | 'STAFF', meta: RequestMetaInfo) {
    const minutes = this.config.get('PASSWORD_RESET_TTL_MINUTES');
    // One working link at a time: a new one replaces any earlier one.
    await this.prisma.passwordReset.updateMany({ where: { userId: u.id, usedAt: null }, data: { usedAt: new Date() } });
    const { token, hash } = newResetToken();
    await this.prisma.passwordReset.create({ data: { userId: u.id, tokenHash: hash, expiresAt: new Date(Date.now() + minutes * 60_000), requestedBy: by, requestedIp: meta.ip ?? null } });
    const url = `${this.config.get('DASHBOARD_URL').replace(/\/$/, '')}/reset-password?token=${token}`;
    await this.email.send({ to: u.email!, ...resetEmail({ name: u.name, url, minutes, byStaff: by === 'STAFF' }) });
  }

  private async setPassword(userId: string, password: string) {
    const passwordHash = await bcrypt.hash(password, this.config.get('BCRYPT_ROUNDS'));
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() } });
  }

  /** Notices are best-effort: the password is already changed when one fails. */
  private async notify(to: string | null, build: () => { subject: string; text: string; html?: string }) {
    if (!to || !this.email.canSend) return;
    await this.email.send({ to, ...build() }).catch((e: Error) => this.logger.warn(`password notice not sent: ${e.message}`));
  }
}

/** "a•••@petapp.in": enough to recognise, not enough to harvest. */
export function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}
