import dotenv from 'dotenv';

dotenv.config();

export interface EnvConfig {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  MONGODB_URI: string;
  JWT_ACCESS_SECRET: string;
  REFRESH_TOKEN_SECRET: string;
  COOKIE_SECRET: string;
  FRONTEND_URL: string;
  UPSTASH_REDIS_URL?: string;
  RESEND_API_KEY?: string;
  SSLCZ_STORE_ID: string;
  SSLCZ_STORE_PASSWD: string;
  SSLCZ_SANDBOX: boolean;
  SSLCZ_SUCCESS_URL: string;
  SSLCZ_FAIL_URL: string;
  SSLCZ_CANCEL_URL: string;
  SSLCZ_IPN_URL: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  SEED_DEMO: boolean;
}

const nodeEnvRaw = process.env.NODE_ENV ?? 'development';
const nodeEnv: EnvConfig['NODE_ENV'] =
  nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development';

const DEV_JWT_ACCESS = 'dev-jwt-access-secret-minimum-32-characters-long';
const DEV_REFRESH = 'dev-refresh-cookie-secret-minimum-32-characters';
const DEV_COOKIE = 'dev-cookie-secret-minimum-32-characters-long';

if (nodeEnv === 'production') {
  const missing: string[] = [];
  if (!process.env.MONGODB_URI) {
    missing.push('MONGODB_URI');
  }
  if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET === DEV_JWT_ACCESS) {
    missing.push('JWT_ACCESS_SECRET');
  }
  if (!process.env.REFRESH_TOKEN_SECRET || process.env.REFRESH_TOKEN_SECRET === DEV_REFRESH) {
    missing.push('REFRESH_TOKEN_SECRET');
  }
  if (!process.env.COOKIE_SECRET || process.env.COOKIE_SECRET === DEV_COOKIE) {
    missing.push('COOKIE_SECRET');
  }
  if (!process.env.FRONTEND_URL) {
    missing.push('FRONTEND_URL');
  }
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Production boot failed due to missing or unsafe environment variables: ${missing.join(', ')}`,
    );
  }
}

const defaultApiBase = process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL}/api/v1/billing`
  : process.env.BACKEND_URL
    ? `${process.env.BACKEND_URL}/api/v1/billing`
    : 'http://localhost:4000/api/v1/billing';

export const env: EnvConfig = {
  PORT: Number(process.env.PORT ?? 4000),
  NODE_ENV: nodeEnv,
  MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/dokanos',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? DEV_JWT_ACCESS,
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET ?? DEV_REFRESH,
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? DEV_COOKIE,
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  UPSTASH_REDIS_URL: process.env.UPSTASH_REDIS_URL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  SSLCZ_STORE_ID: process.env.SSLCZ_STORE_ID ?? 'testbox',
  SSLCZ_STORE_PASSWD: process.env.SSLCZ_STORE_PASSWD ?? 'qwerty',
  SSLCZ_SANDBOX: (process.env.SSLCZ_SANDBOX ?? 'true') === 'true',
  SSLCZ_SUCCESS_URL: process.env.SSLCZ_SUCCESS_URL ?? `${defaultApiBase}/sslcommerz/success`,
  SSLCZ_FAIL_URL: process.env.SSLCZ_FAIL_URL ?? `${defaultApiBase}/sslcommerz/fail`,
  SSLCZ_CANCEL_URL: process.env.SSLCZ_CANCEL_URL ?? `${defaultApiBase}/sslcommerz/cancel`,
  SSLCZ_IPN_URL: process.env.SSLCZ_IPN_URL ?? `${defaultApiBase}/sslcommerz/ipn`,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  SEED_DEMO: nodeEnv === 'production' ? false : (process.env.SEED_DEMO ?? 'true') === 'true',
};
