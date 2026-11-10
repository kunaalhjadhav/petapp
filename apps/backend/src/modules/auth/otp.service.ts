import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from '../../providers/sms/sms.provider';
import { hmac, numericCode, safeEqualHex } from '../../common/utils/crypto';
import type { OtpPurpose } from '../../generated/prisma/client';

export class TooManyRequests extends HttpException {
  constructor(message: string, retryAfterSeconds?: number) {
    super({ message, errors: retryAfterSeconds ? [{ code: 'RETRY_AFTER', message: String(retryAfterSeconds) }] : [] }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private hash(phone: string, code: string): string {
    return hmac(this.config.get('OTP_PEPPER'), `${phone}:${code}`);
  }

  /** Issues and sends an OTP. `phone` must already be E.164-normalised. */
  async request(phone: string, ip?: string, purpose: OtpPurpose = 'LOGIN') {
    const now = Date.now();
    const cooldown = this.config.get('OTP_RESEND_COOLDOWN_SECONDS');
    const last = await this.prisma.otpCode.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
    if (last && cooldown > 0) {
      const wait = Math.ceil((last.createdAt.getTime() + cooldown * 1000 - now) / 1000);
      if (wait > 0) throw new TooManyRequests(`Please wait ${wait} seconds before requesting another code.`, wait);
    }
    const sentLastHour = await this.prisma.otpCode.count({ where: { phone, createdAt: { gte: new Date(now - 3600_000) } } });
    if (sentLastHour >= this.config.get('OTP_MAX_PER_HOUR')) {
      throw new TooManyRequests('Too many codes requested for this number. Please try again later.');
    }

    const ttl = this.config.get('OTP_TTL_SECONDS');
    const code = numericCode(this.config.get('OTP_LENGTH'));
    // Invalidate any still-open codes for this number, then store the new one.
    await this.prisma.$transaction([
      this.prisma.otpCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: new Date(now) } }),
      this.prisma.otpCode.create({
        data: { phone, purpose, codeHash: this.hash(phone, code), expiresAt: new Date(now + ttl * 1000), ipAddress: ip },
      }),
    ]);

    const body = this.config
      .get('OTP_MESSAGE_TEMPLATE')
      .replace('{code}', code)
      .replace('{minutes}', String(Math.round(ttl / 60)));
    await this.sms.send({ to: phone, body });
    return { expiresIn: ttl, resendIn: cooldown };
  }

  /** Verifies and consumes the latest OTP. Throws on failure. */
  async verify(phone: string, code: string, purpose: OtpPurpose = 'LOGIN'): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('This code has expired. Please request a new one.');

    const max = this.config.get('OTP_MAX_ATTEMPTS');
    if (otp.attempts >= max) throw new TooManyRequests('Too many wrong attempts. Please request a new code.');

    if (!/^\d+$/.test(code) || !safeEqualHex(otp.codeHash, this.hash(phone, code))) {
      const updated = await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      const left = Math.max(0, max - updated.attempts);
      throw new BadRequestException({
        message: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Please request a new code.',
        errors: [{ field: 'code', code: 'OTP_INVALID', message: `attemptsLeft=${left}` }],
      });
    }

    // Atomic consume: prevents the same code being used twice concurrently.
    const consumed = await this.prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new BadRequestException('This code has already been used. Please request a new one.');
  }
}
