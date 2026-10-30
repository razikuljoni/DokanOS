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

export const env: EnvConfig = {
  PORT: Number(process.env.PORT ?? 4000),
  NODE_ENV: nodeEnv,
  MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/dokanos',
  JWT_ACCESS_SECRET:
    process.env.JWT_ACCESS_SECRET ?? 'dev-jwt-access-secret-minimum-32-characters-long',
  REFRESH_TOKEN_SECRET:
    process.env.REFRESH_TOKEN_SECRET ?? 'dev-refresh-cookie-secret-minimum-32-characters',
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? 'dev-cookie-secret-minimum-32-characters-long',
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  UPSTASH_REDIS_URL: process.env.UPSTASH_REDIS_URL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  SSLCZ_STORE_ID: process.env.SSLCZ_STORE_ID ?? 'testbox',
  SSLCZ_STORE_PASSWD: process.env.SSLCZ_STORE_PASSWD ?? 'qwerty',
  SSLCZ_SANDBOX: (process.env.SSLCZ_SANDBOX ?? 'true') === 'true',
  SSLCZ_SUCCESS_URL:
    process.env.SSLCZ_SUCCESS_URL ?? 'http://localhost:4000/api/v1/billing/sslcommerz/success',
  SSLCZ_FAIL_URL:
    process.env.SSLCZ_FAIL_URL ?? 'http://localhost:4000/api/v1/billing/sslcommerz/fail',
  SSLCZ_CANCEL_URL:
    process.env.SSLCZ_CANCEL_URL ?? 'http://localhost:4000/api/v1/billing/sslcommerz/cancel',
  SSLCZ_IPN_URL:
    process.env.SSLCZ_IPN_URL ?? 'http://localhost:4000/api/v1/billing/sslcommerz/ipn',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  SEED_DEMO: (process.env.SEED_DEMO ?? 'true') === 'true',
};
