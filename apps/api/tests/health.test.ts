import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ERROR_CODES } from '@dokanos/shared';
import { createApiApp } from '../src/app.js';

describe('Phase 0 — API Skeleton & Health Check', () => {
  const app = createApiApp();

  it('GET /health returns { ok: true } with status 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
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
