import { z } from 'zod';
import { pemCertificate } from '../prisma/pg-connection';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    CORS_ORIGINS: csv,
    SWAGGER_ENABLED: bool,

    DATABASE_URL: z.string().url(),
    /** The managed database's CA certificate (PEM, or base64 of it): connections are verified against it. */
    DATABASE_CA_CERT: z.string().optional(),
    REDIS_URL: z.string().url(),
    /** A managed Redis/Valkey's CA certificate (PEM, or base64 of it), for rediss:// URLs signed by the provider's own CA. */
    REDIS_CA_CERT: z.string().optional(),

    JWT_ISSUER: z.string().default('petapp'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TTL_DAYS_APP: z.coerce.number().int().min(1).default(30),
    REFRESH_TTL_HOURS_ADMIN: z.coerce.number().int().min(1).default(12),
    // A rotated refresh token reused within this window is treated as a concurrent refresh
    // (parallel browser requests), not theft. 0 disables the grace window.
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(15),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    OTP_PEPPER: z.string().min(16, 'OTP_PEPPER must be at least 16 characters'),
    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(30),
    OTP_MAX_PER_HOUR: z.coerce.number().int().min(1).default(5),
    OTP_MESSAGE_TEMPLATE: z
      .string()
      .default('{code} is your PetApp verification code. It is valid for {minutes} minutes. Do not share it with anyone.'),
    DEFAULT_COUNTRY_CODE: z.string().regex(/^\d{1,3}$/).default('91'),

    SMS_PROVIDER: z.enum(['console', 'smslocal']).default('console'),
    SMSLOCAL_API_URL: z.string().url().optional(),
    SMSLOCAL_API_KEY: z.string().optional(),
    SMSLOCAL_SENDER_ID: z.string().optional(),
    SMSLOCAL_DLT_TEMPLATE_ID: z.string().optional(),
    SMSLOCAL_DLT_ENTITY_ID: z.string().optional(),

    // Email (Phase 9e: staff password resets and notices). "console" prints emails in the API log (development
    // only); "smtp" sends through any SMTP service (Amazon SES, SendGrid, Mailgun, Zoho, Google Workspace …).
    MAP_PROVIDER: z.enum(['none', 'google']).default('none'),
    GOOGLE_MAPS_KEY: z.string().optional(),
    EMAIL_PROVIDER: z.enum(['none', 'console', 'smtp']).default('none'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    /** true for port 465 (TLS from the start); false uses STARTTLS on 587. */
    SMTP_SECURE: bool,
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    /** The sender, e.g. "PetApp <no-reply@petapp.in>". */
    EMAIL_FROM: z.string().default('PetApp <no-reply@localhost>'),
    /** The Admin Dashboard's address, for links in emails (password reset). */
    DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),

    // Object storage (S3, Cloudflare R2, MinIO). Media endpoints return 503 until configured.
    S3_ENDPOINT: z.string().url().optional(),
    /** Address clients use to reach storage, when it differs from the internal one (e.g. Docker). */
    S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool,
    /** CDN base URL serving the bucket's media/ prefix. Without it, processed media is served via short-lived signed URLs. */
    MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),
    UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

    // Payments. "fake" is for development and tests only (refused in staging/production).
    PAYMENT_PROVIDER: z.enum(['fake', 'razorpay']).default('fake'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    // Payouts to sellers, partners and prize winners. "fake" is for development and tests only.
    PAYOUT_PROVIDER: z.enum(['fake', 'razorpayx']).default('fake'),
    /** RazorpayX API keys (often the same as the Razorpay keys). */
    RAZORPAYX_KEY_ID: z.string().optional(),
    RAZORPAYX_KEY_SECRET: z.string().optional(),
    /** The RazorpayX current account number payouts are sent from. */
    RAZORPAYX_ACCOUNT_NUMBER: z.string().optional(),
    RAZORPAYX_WEBHOOK_SECRET: z.string().optional(),
    /** 32-byte key (base64) encrypting payees' bank account numbers at rest. Required in staging/production. */
    PAYOUT_DATA_KEY: z.string().optional(),
    /** 32-byte key (base64) encrypting staff two-factor secrets at rest (Phase 10a). Required in staging/production. */
    MFA_DATA_KEY: z.string().optional(),

    // AI moderation. "rules" = built-in keyword rules (no network); "anthropic" = Claude through the Messages API.
    AI_PROVIDER: z.enum(['rules', 'anthropic']).default('rules'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
    /** A fast, inexpensive model is right for moderation; any Messages API model id works. */
    AI_MODERATION_MODEL: z.string().min(1).default('claude-haiku-5-5'),
    AI_ASSISTANT_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
    AI_ASSISTANT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),

    // Push notifications (Firebase Cloud Messaging HTTP v1, service-account credentials).
    PUSH_PROVIDER: z.enum(['none', 'console', 'fcm']).default('none'),
    FCM_PROJECT_ID: z.string().optional(),
    FCM_CLIENT_EMAIL: z.string().optional(),
    /** PEM private key; literal "\n" sequences are accepted. */
    FCM_PRIVATE_KEY: z.string().optional(),

    // Observability. Logs are JSON lines in staging/production unless LOG_FORMAT says otherwise.
    LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** Error reports: "sentry" sends them to Sentry (or a compatible service like GlitchTip) at SENTRY_DSN. */
    ERROR_TRACKER: z.enum(['none', 'sentry']).default('none'),
    SENTRY_DSN: z.string().url().optional(),
    /** The build being run (e.g. the git commit), attached to error reports. */
    APP_RELEASE: z.string().optional(),
    /** Bearer token for GET /metrics. Without it, metrics are only served outside staging/production. */
    METRICS_TOKEN: z.string().min(16, 'METRICS_TOKEN must be at least 16 characters').optional(),
    /** The worker's own /health and /metrics port. */
    WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
    /** Load tests only: multiplies every rate limit. Must be 1 in production. */
    RATE_LIMIT_MULTIPLIER: z.coerce.number().int().min(1).max(1000).default(1),

    GOOGLE_CLIENT_IDS: csv,
    APPLE_CLIENT_IDS: csv,
  })
  .superRefine((env, ctx) => {
    const live = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
    if (env.NODE_ENV === 'production' && env.RATE_LIMIT_MULTIPLIER !== 1) {
      ctx.addIssue({ code: 'custom', path: ['RATE_LIMIT_MULTIPLIER'], message: 'RATE_LIMIT_MULTIPLIER is for load tests and must be 1 in production' });
    }
    for (const k of ['DATABASE_CA_CERT', 'REDIS_CA_CERT'] as const) {
      try {
        pemCertificate(env[k], k);
      } catch (e) {
        ctx.addIssue({ code: 'custom', path: [k], message: (e as Error).message });
      }
    }
    if (live && env.PUSH_PROVIDER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['PUSH_PROVIDER'], message: 'console push provider is not allowed in staging/production' });
    }
    if (live && env.SMS_PROVIDER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'console SMS provider is not allowed in staging/production' });
    }
    if (env.SMS_PROVIDER === 'smslocal') {
      for (const k of ['SMSLOCAL_API_URL', 'SMSLOCAL_API_KEY', 'SMSLOCAL_SENDER_ID'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when SMS_PROVIDER=smslocal` });
      }
    }
    if (live && env.EMAIL_PROVIDER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'console email provider is not allowed in staging/production' });
    }
    if (env.MAP_PROVIDER === 'google' && !env.GOOGLE_MAPS_KEY) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_MAPS_KEY'], message: 'is required when MAP_PROVIDER=google' });
    }
    if (env.EMAIL_PROVIDER === 'smtp') {
      for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when EMAIL_PROVIDER=smtp` });
      }
    }
    if (live && env.EMAIL_PROVIDER !== 'none' && !env.DASHBOARD_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['DASHBOARD_URL'], message: 'DASHBOARD_URL must be https in staging/production (it goes into password-reset links)' });
    }
    if (live && env.PAYMENT_PROVIDER === 'fake') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'the fake payment provider is not allowed in staging/production' });
    }
    if (env.PAYMENT_PROVIDER === 'razorpay') {
      for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when PAYMENT_PROVIDER=razorpay` });
      }
    }
    if (live && env.PAYOUT_PROVIDER === 'fake') {
      ctx.addIssue({ code: 'custom', path: ['PAYOUT_PROVIDER'], message: 'the fake payout provider is not allowed in staging/production' });
    }
    if (env.PAYOUT_PROVIDER === 'razorpayx') {
      for (const k of ['RAZORPAYX_KEY_ID', 'RAZORPAYX_KEY_SECRET', 'RAZORPAYX_ACCOUNT_NUMBER', 'RAZORPAYX_WEBHOOK_SECRET'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when PAYOUT_PROVIDER=razorpayx` });
      }
    }
    if (env.ERROR_TRACKER === 'sentry' && !env.SENTRY_DSN) {
      ctx.addIssue({ code: 'custom', path: ['SENTRY_DSN'], message: 'is required when ERROR_TRACKER=sentry' });
    }
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'is required when AI_PROVIDER=anthropic' });
    }
    if (env.PAYOUT_DATA_KEY !== undefined && Buffer.from(env.PAYOUT_DATA_KEY, 'base64').length !== 32) {
      ctx.addIssue({ code: 'custom', path: ['PAYOUT_DATA_KEY'], message: 'must be 32 bytes, base64-encoded' });
    }
    if (env.MFA_DATA_KEY !== undefined && Buffer.from(env.MFA_DATA_KEY, 'base64').length !== 32) {
      ctx.addIssue({ code: 'custom', path: ['MFA_DATA_KEY'], message: 'must be 32 bytes, base64-encoded' });
    }
    if (live && !env.MFA_DATA_KEY) {
      ctx.addIssue({ code: 'custom', path: ['MFA_DATA_KEY'], message: 'is required in staging/production (encrypts staff two-factor secrets)' });
    }
    if (live && !env.PAYOUT_DATA_KEY) {
      ctx.addIssue({ code: 'custom', path: ['PAYOUT_DATA_KEY'], message: 'is required in staging/production (encrypts bank account numbers)' });
    }
    if (env.PUSH_PROVIDER === 'fcm') {
      for (const k of ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when PUSH_PROVIDER=fcm` });
      }
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_ACCESS_SECRET' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // An empty value (`S3_ENDPOINT=` in a .env file, or a field left blank in a hosting dashboard) means "not set",
  // so optional settings fall back to their defaults instead of failing as an invalid URL or number.
  const given = Object.fromEntries(Object.entries(raw).filter(([, v]) => !(typeof v === 'string' && v.trim() === '')));
  const parsed = envSchema.safeParse(given);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}
