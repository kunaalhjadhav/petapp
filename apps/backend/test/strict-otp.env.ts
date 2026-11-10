// Imported first by security.e2e-spec.ts so the API is built with realistic OTP limits.
process.env.OTP_MAX_PER_HOUR = '3';
export {};
