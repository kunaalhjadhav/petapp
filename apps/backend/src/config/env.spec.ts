import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  OTP_PEPPER: 'c'.repeat(16),
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.OTP_LENGTH).toBe(6);
    expect(env.SMS_PROVIDER).toBe('console');
  });
  it('rejects short secrets', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });
  it('rejects identical access and refresh secrets', () => {
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET })).toThrow(/JWT_REFRESH_SECRET/);
  });
  it('forbids the console SMS provider in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
  });
  it('requires SMSLocal credentials when selected', () => {
    expect(() => validateEnv({ ...base, SMS_PROVIDER: 'smslocal' })).toThrow(/SMSLOCAL_API_KEY/);
  });
  it('refuses the fake payment provider in production and needs Razorpay keys when selected', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', SMS_PROVIDER: 'smslocal', SMSLOCAL_API_URL: 'https://x.example', SMSLOCAL_API_KEY: 'k', SMSLOCAL_SENDER_ID: 'S' })).toThrow(/PAYMENT_PROVIDER/);
    expect(() => validateEnv({ ...base, PAYMENT_PROVIDER: 'razorpay' })).toThrow(/RAZORPAY_KEY_SECRET/);
  });
  it('allows a rate-limit multiplier for load tests, but never in production', () => {
    expect(validateEnv({ ...base, RATE_LIMIT_MULTIPLIER: '50' }).RATE_LIMIT_MULTIPLIER).toBe(50);
    expect(validateEnv(base).RATE_LIMIT_MULTIPLIER).toBe(1);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', RATE_LIMIT_MULTIPLIER: '50' })).toThrow(/RATE_LIMIT_MULTIPLIER/);
  });
  it('checks the email settings (Phase 9e)', () => {
    expect(validateEnv(base).EMAIL_PROVIDER).toBe('none');
    expect(() => validateEnv({ ...base, EMAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(validateEnv({ ...base, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example', SMTP_USER: 'u', SMTP_PASS: 'p' }).SMTP_PORT).toBe(587);
    const live = { ...base, NODE_ENV: 'production', SMS_PROVIDER: 'smslocal', SMSLOCAL_API_URL: 'https://x.example', SMSLOCAL_API_KEY: 'k', SMSLOCAL_SENDER_ID: 'S' };
    expect(() => validateEnv({ ...live, EMAIL_PROVIDER: 'console' })).toThrow(/console email provider/);
    expect(() => validateEnv({ ...live, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' })).toThrow(/DASHBOARD_URL must be https/);
  });
  it('checks the map and push settings (final release)', () => {
    expect(validateEnv(base).MAP_PROVIDER).toBe('none');
    expect(() => validateEnv({ ...base, MAP_PROVIDER: 'google' })).toThrow(/GOOGLE_MAPS_KEY/);
    expect(validateEnv({ ...base, MAP_PROVIDER: 'google', GOOGLE_MAPS_KEY: 'k' }).MAP_PROVIDER).toBe('google');
    expect(() => validateEnv({ ...base, MAP_PROVIDER: 'osm' })).toThrow(/MAP_PROVIDER/);
    const live = { ...base, NODE_ENV: 'production', SMS_PROVIDER: 'smslocal', SMSLOCAL_API_URL: 'https://x.example', SMSLOCAL_API_KEY: 'k', SMSLOCAL_SENDER_ID: 'S' };
    expect(() => validateEnv({ ...live, PUSH_PROVIDER: 'console' })).toThrow(/console push provider/);
  });
  it('checks the database CA certificate', () => {
    expect(validateEnv({ ...base, DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----' }).DATABASE_CA_CERT).toBeDefined();
    expect(() => validateEnv({ ...base, DATABASE_CA_CERT: 'not-a-cert' })).toThrow(/DATABASE_CA_CERT/);
  });
  it('treats empty values as not set', () => {
    const e = validateEnv({ ...base, S3_ENDPOINT: '', MEDIA_PUBLIC_BASE_URL: '  ', SMTP_PORT: '', S3_REGION: '', MAP_PROVIDER: '' });
    expect(e.S3_ENDPOINT).toBeUndefined();
    expect(e.MEDIA_PUBLIC_BASE_URL).toBeUndefined();
    expect(e.SMTP_PORT).toBe(587);
    expect(e.S3_REGION).toBe('ap-south-1');
    expect(e.MAP_PROVIDER).toBe('none');
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: '' })).toThrow(/JWT_ACCESS_SECRET/);
  });
  it('parses CSV lists', () => {
    expect(validateEnv({ ...base, GOOGLE_CLIENT_IDS: 'a, b ,,c' }).GOOGLE_CLIENT_IDS).toEqual(['a', 'b', 'c']);
  });
});
