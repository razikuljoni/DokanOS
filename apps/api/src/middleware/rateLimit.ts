import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '@dokanos/shared';

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300, // 300 requests per 15 min per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests, please try again later.',
    },
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // 10 attempts per 15 min per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many authentication attempts, please try again in 15 minutes.',
    },
  },
});
