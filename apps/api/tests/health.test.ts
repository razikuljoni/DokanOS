import { describe, expect, it, afterAll } from 'vitest';
import request from 'supertest';
import { ERROR_CODES } from '@dokanos/shared';
import { createApiApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';

describe('API Health Check & Probes', () => {
  const app = createApiApp();

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('GET /health returns 503 when primary database is disconnected', async () => {
    await disconnectDatabase();
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('Database connection offline');
    expect(res.body.services?.database).toBe('disconnected');
  });

  it('GET /health returns 200 and database connected when DB is online', async () => {
    await connectDatabase();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.services?.database).toBe('connected');
  });

  it('GET /api/v1/unknown returns 404 with standard error envelope', async () => {
    const res = await request(app).get('/api/v1/unknown-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Endpoint not found',
      },
    });
  });
});
