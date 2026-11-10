import { BadRequestException, HttpException } from '@nestjs/common';
import { OtpService } from './otp.service';
import type { AppConfig } from '../../config/app-config.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SmsProvider } from '../../providers/sms/sms.provider';

type Row = {
  id: string;
  phone: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};
type Where = Record<string, unknown>;

/** Minimal in-memory stand-in for the OtpCode table. */
function fakePrisma() {
  const rows: Row[] = [];
  let n = 0;
  const match = (r: Row, w: Where) =>
    (!w.id || r.id === w.id) &&
    (!w.phone || r.phone === w.phone) &&
    (!('consumedAt' in w) || r.consumedAt === null) &&
    (!w.expiresAt || r.expiresAt > (w.expiresAt as { gt: Date }).gt) &&
    (!w.createdAt || r.createdAt >= (w.createdAt as { gte: Date }).gte);
  const otpCode = {
    findFirst: async ({ where }: { where: Where }) => [...rows].reverse().find((r) => match(r, where)) ?? null,
    count: async ({ where }: { where: Where }) => rows.filter((r) => match(r, where)).length,
    create: async ({ data }: { data: Partial<Row> }) => {
      const r = { id: String(++n), attempts: 0, consumedAt: null, createdAt: new Date(), ...data } as Row;
      rows.push(r);
      return r;
    },
    update: async ({ where, data }: { where: { id: string }; data: { attempts: { increment: number } } }) => {
      const r = rows.find((x) => x.id === where.id)!;
      r.attempts += data.attempts.increment;
      return r;
    },
    updateMany: async ({ where, data }: { where: Where; data: Partial<Row> }) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
  return { rows, otpCode, $transaction: (ops: Promise<unknown>[]) => Promise.all(ops) };
}

const cfg: Record<string, unknown> = {
  OTP_PEPPER: 'pepper-pepper-pepper',
  OTP_LENGTH: 6,
  OTP_TTL_SECONDS: 300,
  OTP_MAX_ATTEMPTS: 3,
  OTP_RESEND_COOLDOWN_SECONDS: 30,
  OTP_MAX_PER_HOUR: 5,
  OTP_MESSAGE_TEMPLATE: 'Code {code} valid {minutes} min',
};

describe('OtpService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let sent: string[];
  let svc: OtpService;
  const phone = '+919812345678';
  const lastCode = () => sent[sent.length - 1].match(/\d{6}/)![0];

  beforeEach(() => {
    prisma = fakePrisma();
    sent = [];
    const sms: SmsProvider = {
      name: 'test',
      send: async (m) => {
        sent.push(m.body);
        return {};
      },
    };
    svc = new OtpService(prisma as unknown as PrismaService, { get: (k: string) => cfg[k] } as unknown as AppConfig, sms);
  });

  it('sends a code using the template and never stores it in plain text', async () => {
    await svc.request(phone);
    expect(sent[0]).toMatch(/^Code \d{6} valid 5 min$/);
    expect(prisma.rows[0].codeHash).not.toContain(lastCode());
  });

  it('verifies the right code exactly once', async () => {
    await svc.request(phone);
    const code = lastCode();
    await expect(svc.verify(phone, code)).resolves.toBeUndefined();
    await expect(svc.verify(phone, code)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts wrong attempts and locks after the maximum', async () => {
    await svc.request(phone);
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) await expect(svc.verify(phone, wrong)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.verify(phone, code)).rejects.toMatchObject({ status: 429 });
  });

  it('enforces the resend cooldown', async () => {
    await svc.request(phone);
    await expect(svc.request(phone)).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects expired codes', async () => {
    await svc.request(phone);
    prisma.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.verify(phone, lastCode())).rejects.toThrow(/expired/);
  });
});
