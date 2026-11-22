import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import type { HealthResponse } from '@dokanos/shared';
import { env } from './config/env.js';
import { checkRedisHealth } from './config/redis.js';
import { globalRateLimiter, authRateLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/routes.js';
import { tenantsRouter } from './modules/tenants/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { productsRouter } from './modules/products/routes.js';
import { stockRouter } from './modules/stock/routes.js';
import { salesRouter } from './modules/sales/routes.js';
import { purchasesRouter } from './modules/purchases/routes.js';
import { suppliersRouter } from './modules/suppliers/routes.js';
import { customersRouter } from './modules/customers/routes.js';
import { duesRouter } from './modules/dues/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { billingRouter } from './modules/billing/routes.js';
import { jobsRouter } from './queues/worker.js';

export function createApiApp(): Express {
  const app = express();
  app.set('trust proxy', 1);

  const allowedOrigins = new Set<string>([env.FRONTEND_URL]);
  if (env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://localhost:3000');
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    }),
  );

  app.use(
    express.json({
      limit: '2mb',
      verify: (req: import('http').IncomingMessage & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser(env.COOKIE_SECRET));

  if (env.NODE_ENV !== 'test') {
    app.use('/api', globalRateLimiter);
  }

  const healthHandler = async (_req: express.Request, res: express.Response) => {
    const isDbConnected = mongoose.connection.readyState === 1;
    const redisStatus = await checkRedisHealth();

    if (!isDbConnected) {
      const response: HealthResponse = {
        ok: false,
        services: {
          database: 'disconnected',
          redis: redisStatus,
        },
        error: 'Database connection offline',
      };
      res.status(503).json(response);
      return;
    }

    const response: HealthResponse = {
      ok: true,
      services: {
        database: 'connected',
        redis: redisStatus,
      },
    };
    res.status(200).json(response);
  };

  app.get('/health', healthHandler);
  app.get('/api/v1/health', healthHandler);

  // Apply stricter auth limiting outside test runs.
  if (env.NODE_ENV !== 'test') {
    app.use('/api/v1/auth', authRateLimiter);
  }
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/tenants', tenantsRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/products', productsRouter);
  app.use('/api/v1/stock', stockRouter);
  app.use('/api/v1/sales', salesRouter);
  app.use('/api/v1/purchases', purchasesRouter);
  app.use('/api/v1/suppliers', suppliersRouter);
  app.use('/api/v1/customers', customersRouter);
  app.use('/api/v1/dues', duesRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/billing', billingRouter);
  app.use('/api/v1/admin/jobs', jobsRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const apiApp = createApiApp();
