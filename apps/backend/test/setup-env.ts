// E2E tests run against a dedicated database and Redis DB index — never your dev data.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/petapp_test';
process.env.REDIS_URL = process.env.REDIS_URL_TEST ?? 'redis://localhost:6379/15';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789abcdef012';
process.env.OTP_PEPPER ??= 'test-otp-pepper-0123456789';
process.env.SMS_PROVIDER = 'console';
process.env.BCRYPT_ROUNDS = '10';
process.env.OTP_RESEND_COOLDOWN_SECONDS = '0';
process.env.OTP_MAX_PER_HOUR = '1000';
process.env.REFRESH_REUSE_GRACE_SECONDS = '0'; // reuse-detection tests need the strict behaviour
// Object storage for media tests: any S3-compatible endpoint (moto or MinIO locally and in CI).
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'petapp-test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';
process.env.S3_FORCE_PATH_STYLE ??= 'true';
process.env.S3_REGION ??= 'ap-south-1';
