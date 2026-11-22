import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ERROR_CODES } from '@dokanos/shared';
import { createApiApp } from '../src/app.js';
import {
  AuditLogModel,
  CustomerModel,
  DuePaymentModel,
  NotificationModel,
  PaymentModel,
  ProductModel,
  PurchaseModel,
  RefreshTokenModel,
  SaleModel,
  StockMovementModel,
  SubscriptionModel,
  SupplierModel,
  TenantModel,
  UserModel,
} from '../src/models/index.js';
import { clearAllCacheForTests } from '../src/config/redis.js';
import Stripe from 'stripe';
import { env } from '../src/config/env.js';
import { executeJobForTenant } from '../src/queues/worker.js';

describe('DokanOS §9 Integration & Security Suite (Vitest + Supertest + MongoMemoryReplSet)', () => {
  const app = createApiApp();
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = replSet.getUri('dokanos_test');
    await mongoose.connect(uri);
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  beforeEach(async () => {
    clearAllCacheForTests();
    await Promise.all([
      TenantModel.deleteMany({}),
      UserModel.deleteMany({}),
      RefreshTokenModel.deleteMany({}),
      ProductModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
      SaleModel.deleteMany({}),
      PurchaseModel.deleteMany({}),
      SupplierModel.deleteMany({}),
      DuePaymentModel.deleteMany({}),
      PaymentModel.deleteMany({}),
      SubscriptionModel.deleteMany({}),
      NotificationModel.deleteMany({}),
      CustomerModel.deleteMany({}),
      AuditLogModel.deleteMany({}),
    ]);
  });

  async function registerShop(params: {
    shopName: string;
    email: string;
    shopType?: 'pharmacy' | 'grocery' | 'electronics' | 'general';
  }) {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        shopName: params.shopName,
        shopType: params.shopType ?? 'pharmacy',
        ownerName: `${params.shopName} Owner`,
        email: params.email,
        password: 'Password123!',
      });
    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    const rawCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    return {
      accessToken: res.body.accessToken as string,
      tenantId: res.body.tenant.id as string,
      userId: res.body.user.id as string,
      cookie: rawCookie ?? '',
    };
  }

  // 1. Tenant isolation
  it('1. Tenant isolation: user from Tenant A cannot access Tenant B products, sales, dues, or dashboard', async () => {
    const shopA = await registerShop({ shopName: 'Shop Alpha', email: 'alpha@shop.bd' });
    const shopB = await registerShop({ shopName: 'Shop Beta', email: 'beta@shop.bd' });

    // Seed product + sale in Shop B
    const prodBRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${shopB.accessToken}`)
      .send({
        name: 'Beta Exclusive Medicine',
        category: 'Medicine',
        unit: 'box',
        sku: 'BETA-001',
        costPrice: 100,
        sellPrice: 150,
        stock: 20,
      });
    expect(prodBRes.status).toBe(201);
    const prodBId = prodBRes.body.data._id as string;

    const saleBRes = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shopB.accessToken}`)
      .send({
        items: [{ productId: prodBId, qty: 2 }],
        discount: 0,
        paymentMethod: 'cash',
        paidAmount: 100, // leaves 200 due
        customerName: 'Beta Customer',
      });
    expect(saleBRes.status).toBe(201);
    const saleBId = saleBRes.body.data._id as string;

    // Tenant A lists products -> must see 0 rows
    const listProdA = await request(app)
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${shopA.accessToken}`);
    expect(listProdA.status).toBe(200);
    expect(listProdA.body.data).toHaveLength(0);

    // Tenant A requests Tenant B product by ID -> 404
    const getProdBFromA = await request(app)
      .get(`/api/v1/products/${prodBId}`)
      .set('Authorization', `Bearer ${shopA.accessToken}`);
    expect(getProdBFromA.status).toBe(404);

    // Tenant A lists sales -> 0 rows
    const listSalesA = await request(app)
      .get('/api/v1/sales')
      .set('Authorization', `Bearer ${shopA.accessToken}`);
    expect(listSalesA.status).toBe(200);
    expect(listSalesA.body.data).toHaveLength(0);

    // Tenant A requests Tenant B sale by ID -> 404
    const getSaleBFromA = await request(app)
      .get(`/api/v1/sales/${saleBId}`)
      .set('Authorization', `Bearer ${shopA.accessToken}`);
    expect(getSaleBFromA.status).toBe(404);

    // Tenant A requests dues -> 0 rows
    const listDuesA = await request(app)
      .get('/api/v1/dues')
      .set('Authorization', `Bearer ${shopA.accessToken}`);
    expect(listDuesA.status).toBe(200);
    expect(listDuesA.body.data).toHaveLength(0);

    // Tenant A requests dashboard -> 0 revenue
    const dashA = await request(app)
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${shopA.accessToken}`);
    expect(dashA.status).toBe(200);
    expect(dashA.body.data.revenue).toBe(0);
    expect(dashA.body.data.salesCount).toBe(0);

    // Tenant A passes X-Tenant-Id: shopB.tenantId -> 403 TENANT_MISMATCH
    const spoofRes = await request(app)
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${shopA.accessToken}`)
      .set('X-Tenant-Id', shopB.tenantId);
    expect(spoofRes.status).toBe(403);
    expect(spoofRes.body.error.code).toBe(ERROR_CODES.TENANT_MISMATCH);
  });

  // 2. Auth: login, refresh rotation, reuse detection, logout
  it('2. Auth: login sets refresh cookie, refresh rotates token, reuse revokes entire family, and logout revokes', async () => {
    await registerShop({ shopName: 'Auth Pharmacy', email: 'owner@auth.bd' });

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: 'owner@auth.bd',
      password: 'Password123!',
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBeDefined();
    const cookies1 = loginRes.headers['set-cookie'];
    const cookie1 = (Array.isArray(cookies1) ? cookies1[0] : cookies1) ?? '';
    expect(cookie1).toContain('dokanos_rt=');

    // First refresh rotates token -> succeeds and issues cookie2
    const refresh1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie1);
    expect(refresh1.status).toBe(200);
    const cookies2 = refresh1.headers['set-cookie'];
    const cookie2 = (Array.isArray(cookies2) ? cookies2[0] : cookies2) ?? '';
    expect(cookie2).toContain('dokanos_rt=');
    expect(cookie2).not.toBe(cookie1);

    // Presenting old rotated cookie1 again triggers reuse detection -> 401 and revokes entire family
    const reuseRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie1);
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.code).toBe(ERROR_CODES.UNAUTHENTICATED);

    // Now even the latest cookie2 in that family must be rejected because the family was revoked!
    const afterReuseRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie2);
    expect(afterReuseRes.status).toBe(401);

    // Fresh login + logout revokes token
    const login2 = await request(app).post('/api/v1/auth/login').send({
      email: 'owner@auth.bd',
      password: 'Password123!',
    });
    const cookies3 = login2.headers['set-cookie'];
    const cookie3 = (Array.isArray(cookies3) ? cookies3[0] : cookies3) ?? '';

    const logoutRes = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie3);
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie3);
    expect(refreshAfterLogout.status).toBe(401);
  });

  // 3. RBAC enforcement
  it('3. RBAC: staff cannot write products, view billing, or invite users; manager cannot access billing', async () => {
    const shop = await registerShop({ shopName: 'RBAC Shop', email: 'owner@rbac.bd' });

    // Upgrade shop to Pro so we can invite both a manager and a staff member
    await TenantModel.findByIdAndUpdate(shop.tenantId, { $set: { plan: 'pro' } });

    const inviteStaffRes = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Counter Staff',
        email: 'staff@rbac.bd',
        role: 'staff',
        password: 'StaffPassword1!',
      });
    expect(inviteStaffRes.status).toBe(201);

    const inviteManagerRes = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Store Manager',
        email: 'manager@rbac.bd',
        role: 'manager',
        password: 'ManagerPassword1!',
      });
    expect(inviteManagerRes.status).toBe(201);

    const staffLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'staff@rbac.bd',
      password: 'StaffPassword1!',
    });
    const staffToken = staffLogin.body.accessToken as string;

    const managerLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'manager@rbac.bd',
      password: 'ManagerPassword1!',
    });
    const managerToken = managerLogin.body.accessToken as string;

    // Staff calling POST /products -> 403
    const staffProd = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        name: 'Unauthorized Item',
        category: 'Medicine',
        unit: 'pcs',
        sku: 'UNAUTH-1',
        costPrice: 10,
        sellPrice: 20,
        stock: 5,
      });
    expect(staffProd.status).toBe(403);

    // Staff calling GET /billing/plan -> 403
    const staffBilling = await request(app)
      .get('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(staffBilling.status).toBe(403);

    // Staff calling POST /users/invite -> 403
    const staffInvite = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name: 'Another', email: 'another@rbac.bd', role: 'staff' });
    expect(staffInvite.status).toBe(403);

    // Manager calling GET /billing/plan -> 403
    const managerBilling = await request(app)
      .get('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(managerBilling.status).toBe(403);
  });

  // 4. Parallel-sale concurrency
  it('4. Parallel-sale concurrency: two simultaneous sales for stock=1 -> exactly one succeeds, stock ends at 0, other returns INSUFFICIENT_STOCK', async () => {
    const shop = await registerShop({ shopName: 'Concurrency Shop', email: 'owner@conc.bd' });

    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Last Unit Glucometer',
        category: 'Surgical',
        unit: 'pcs',
        sku: 'LAST-001',
        costPrice: 1000,
        sellPrice: 1500,
        stock: 1,
      });
    expect(prodRes.status).toBe(201);
    const productId = prodRes.body.data._id as string;

    const salePayload = {
      items: [{ productId, qty: 1 }],
      discount: 0,
      paymentMethod: 'cash',
      paidAmount: 1500,
    };

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/v1/sales')
        .set('Authorization', `Bearer ${shop.accessToken}`)
        .send(salePayload),
      request(app)
        .post('/api/v1/sales')
        .set('Authorization', `Bearer ${shop.accessToken}`)
        .send(salePayload),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const failedRes = res1.status === 409 ? res1 : res2;
    expect(failedRes.body.error.code).toBe(ERROR_CODES.INSUFFICIENT_STOCK);

    const updatedProd = await ProductModel.findById(productId).lean();
    expect(updatedProd?.stock).toBe(0);
  });

  // 5. Webhook replay idempotency
  it('5. Webhook replay: sending the same SSLCommerz validation callback twice marks Payment paid once and extends plan by 30 days (not 60)', async () => {
    const shop = await registerShop({ shopName: 'Billing Shop', email: 'owner@billing.bd' });

    const initRes = await request(app)
      .post('/api/v1/billing/sslcommerz/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({});
    expect(initRes.status).toBe(201);
    const tranId = initRes.body.data.tranId as string;

    // Paying stacks on the running 14-day trial instead of resetting it, so
    // the 30 days are measured from the trial end, not from the callback.
    const beforePayment = await TenantModel.findById(shop.tenantId).lean();
    const trialEndsMs = new Date(beforePayment!.planExpiresAt!).getTime();

    // First callback
    const cb1 = await request(app)
      .post('/api/v1/billing/sslcommerz/ipn')
      .send({
        tran_id: tranId,
        val_id: 'VAL-TEST-123',
        amount: 499,
        currency: 'BDT',
        status: 'VALID',
      });
    expect(cb1.status).toBe(200);
    expect(cb1.body.data.duplicate).toBe(false);

    // Replay the exact same callback a second time
    const cb2 = await request(app)
      .post('/api/v1/billing/sslcommerz/ipn')
      .send({
        tran_id: tranId,
        val_id: 'VAL-TEST-123',
        amount: 499,
        currency: 'BDT',
        status: 'VALID',
      });
    expect(cb2.status).toBe(200);
    expect(cb2.body.data.duplicate).toBe(true);

    const tenant = await TenantModel.findById(shop.tenantId).lean();
    expect(tenant?.plan).toBe('pro');
    expect(tenant?.trialEndsAt).toBeNull();
    const expiresAtMs = new Date(tenant!.planExpiresAt!).getTime();
    const daysAdded = (expiresAtMs - trialEndsMs) / (1000 * 60 * 60 * 24);
    expect(daysAdded).toBeGreaterThan(29.5);
    expect(daysAdded).toBeLessThan(30.5);
  });

  // 5b. Phase 0 security: SSLCommerz callback without val_id is rejected
  it('5b. Phase 0 security: POST /api/v1/billing/sslcommerz/ipn with missing val_id is rejected with 400', async () => {
    const shop = await registerShop({ shopName: 'ValId Check Shop', email: 'owner@validcheck.bd' });
    const initRes = await request(app)
      .post('/api/v1/billing/sslcommerz/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({});
    expect(initRes.status).toBe(201);
    const tranId = initRes.body.data.tranId as string;

    const res = await request(app)
      .post('/api/v1/billing/sslcommerz/ipn')
      .send({
        tran_id: tranId,
        amount: 499,
        currency: 'BDT',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('val_id is required');
  });

  // 5c. Phase 1 security: SSLCommerz callback with wrong amount is rejected
  it('5c. Phase 1 security: SSLCommerz callback with wrong amount is rejected with 400', async () => {
    const shop = await registerShop({ shopName: 'Wrong Amount Shop', email: 'owner@wrongamount.bd' });
    const initRes = await request(app)
      .post('/api/v1/billing/sslcommerz/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({});
    expect(initRes.status).toBe(201);
    const tranId = initRes.body.data.tranId as string;

    const res = await request(app)
      .post('/api/v1/billing/sslcommerz/ipn')
      .send({
        tran_id: tranId,
        val_id: 'VAL-123',
        amount: 100, // stored amount is 499
        currency: 'BDT',
        status: 'VALID',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Validated amount does not match');
  });

  // 5d. Phase 1 security: unsigned Stripe webhook is rejected
  it('5d. Phase 1 security: unsigned Stripe webhook is rejected with 400', async () => {
    const res = await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .send({ id: 'evt_test_123', type: 'checkout.session.completed' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Missing stripe-signature header');
  });

  // 5e. Phase 1 security: Stripe webhook with invalid signature is rejected
  it('5e. Phase 1 security: Stripe webhook with invalid signature is rejected with 400', async () => {
    env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_tests_1234567890';
    const res = await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('stripe-signature', 't=123456,v1=invalid_signature')
      .send({ id: 'evt_test_123', type: 'checkout.session.completed' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Stripe signature verification failed');
  });

  // 6. Aggregation correctness
  it('6. Aggregation correctness: dashboard summary revenue, COGS profit, and top products match hand-computed values', async () => {
    const shop = await registerShop({ shopName: 'Math Shop', email: 'owner@math.bd' });

    // Product 1: cost 100, sell 150 (margin 50)
    const p1Res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Item One',
        category: 'Medicine',
        unit: 'box',
        sku: 'M-001',
        costPrice: 100,
        sellPrice: 150,
        stock: 50,
      });
    const p1Id = p1Res.body.data._id as string;

    // Product 2: cost 50, sell 80 (margin 30)
    const p2Res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Item Two',
        category: 'Surgical',
        unit: 'pcs',
        sku: 'M-002',
        costPrice: 50,
        sellPrice: 80,
        stock: 50,
      });
    const p2Id = p2Res.body.data._id as string;

    // Sale 1: 2x Item One (300) + 1x Item Two (80) = 380 total, COGS = 2*100 + 1*50 = 250, profit = 130
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        items: [
          { productId: p1Id, qty: 2 },
          { productId: p2Id, qty: 1 },
        ],
        discount: 0,
        paymentMethod: 'cash',
        paidAmount: 380,
      });

    // Sale 2: 3x Item Two (240) with 10 discount = 230 total, COGS = 3*50 = 150, profit = 80
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        items: [{ productId: p2Id, qty: 3 }],
        discount: 10,
        paymentMethod: 'bkash',
        paidAmount: 230,
      });

    // Hand-computed totals:
    // Revenue = 380 + 230 = 610
    // COGS = 250 + 150 = 400
    // Profit = 610 - 400 = 210
    // Top product by line revenue: Item Two (80 + 240 = 320), Item One (300)
    const dashRes = await request(app)
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${shop.accessToken}`);

    expect(dashRes.status).toBe(200);
    expect(dashRes.headers['x-cache']).toBe('MISS');
    expect(dashRes.body.data.revenue).toBe(610);
    expect(dashRes.body.data.profit).toBe(210);
    expect(dashRes.body.data.salesCount).toBe(2);
    expect(dashRes.body.data.topProducts[0].name).toBe('Item Two');
    expect(dashRes.body.data.topProducts[0].revenue).toBe(320);
    expect(dashRes.body.data.topProducts[1].name).toBe('Item One');
    expect(dashRes.body.data.topProducts[1].revenue).toBe(300);

    // Second request hits Redis/memory cache
    const dashCached = await request(app)
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(dashCached.headers['x-cache']).toBe('HIT');
  });

  // 7. Plan limits
  it('7. Plan limits: Free tenant creating the 101st product returns 403 PLAN_LIMIT', async () => {
    const shop = await registerShop({ shopName: 'Free Limit Shop', email: 'owner@limit.bd' });
    // New shops start on a Pro trial (unlimited), so pin this tenant to free
    // to exercise the free-plan limit itself.
    await TenantModel.findByIdAndUpdate(shop.tenantId, {
      $set: { plan: 'free', planExpiresAt: null, trialEndsAt: null },
    });
    const tenantObjectId = new mongoose.Types.ObjectId(shop.tenantId);

    // Bulk seed 100 active products directly for speed
    const hundredProducts = Array.from({ length: 100 }, (_, idx) => ({
      tenantId: tenantObjectId,
      name: `Product ${idx + 1}`,
      category: 'General',
      unit: 'pcs' as const,
      sku: `SKU-${idx + 1}`,
      costPrice: 10,
      sellPrice: 15,
      stock: 10,
      lowStockAt: 5,
      isActive: true,
    }));
    await ProductModel.insertMany(hundredProducts);

    // Attempting to create the 101st product via API -> 403 PLAN_LIMIT
    const res101 = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Product 101',
        category: 'General',
        unit: 'pcs',
        sku: 'SKU-101',
        costPrice: 10,
        sellPrice: 15,
        stock: 10,
      });

    expect(res101.status).toBe(403);
    expect(res101.body.error.code).toBe(ERROR_CODES.PLAN_LIMIT);
  });

  // 8. Zod validation
  it('8. Zod validation: invalid sale body (negative qty, empty items) returns 400 VALIDATION with field details', async () => {
    const shop = await registerShop({ shopName: 'Zod Shop', email: 'owner@zod.bd' });

    const invalidRes = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        items: [{ productId: '', qty: -3 }],
        discount: -10,
        paymentMethod: 'cash',
        paidAmount: 100,
      });

    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error.code).toBe(ERROR_CODES.VALIDATION);
    expect(invalidRes.body.error.details).toBeDefined();
  });

  // 9. Phase 1 — Offline POS & Baki sync idempotency and failure handling
  it('9a. Offline sync: queued POS sale and Baki due payment sync once, assign sequential server invoiceNo, and decrement stock/due once', async () => {
    const shop = await registerShop({ shopName: 'Offline Sync Shop', email: 'owner@offline.bd' });

    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Sergel 20mg Capsule',
        category: 'Medicine',
        unit: 'strip',
        sku: 'OFF-SER-01',
        costPrice: 55,
        sellPrice: 70,
        stock: 10,
      });
    expect(prodRes.status).toBe(201);
    const productId = prodRes.body.data._id as string;

    // Replay queued offline sale with idempotencyKey
    const saleIdemKey = `idem-sale-${shop.tenantId}-10001`;
    const syncSaleRes = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .set('X-Idempotency-Key', saleIdemKey)
      .send({
        idempotencyKey: saleIdemKey,
        items: [{ productId, qty: 3 }],
        discount: 0,
        paymentMethod: 'cash',
        paidAmount: 100, // 210 total -> 110 Baki due
        customerName: 'Karim Bhai',
        customerPhone: '01711223344',
      });

    expect(syncSaleRes.status).toBe(201);
    expect(syncSaleRes.body.data.invoiceNo).toBe('INV-0001');
    expect(syncSaleRes.body.data.dueAmount).toBe(110);

    const afterSaleProd = await ProductModel.findById(productId).lean();
    expect(afterSaleProd?.stock).toBe(7);
  });

  it('9b. Offline sync idempotency: replaying the same idempotencyKey twice for a sale or due payment is a no-op on the second call', async () => {
    const shop = await registerShop({ shopName: 'Idem Shop', email: 'owner@idem.bd' });

    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Monas 10mg Tablet',
        category: 'Medicine',
        unit: 'box',
        sku: 'IDEM-MON-10',
        costPrice: 180,
        sellPrice: 240,
        stock: 15,
      });
    const productId = prodRes.body.data._id as string;

    const saleIdemKey = `idem-sale-${shop.tenantId}-replay-01`;
    const salePayload = {
      idempotencyKey: saleIdemKey,
      items: [{ productId, qty: 2 }],
      discount: 0,
      paymentMethod: 'cash',
      paidAmount: 200, // total 480, due 280
      customerName: 'Rahima Begum',
    };

    const firstSale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send(salePayload);
    expect(firstSale.status).toBe(201);
    const saleId = firstSale.body.data._id as string;

    // Duplicate replay of the exact same offline sale
    const secondSale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send(salePayload);
    expect(secondSale.status).toBe(200);
    expect(secondSale.body.duplicate).toBe(true);
    expect(secondSale.body.data._id).toBe(saleId);
    expect(secondSale.body.data.invoiceNo).toBe('INV-0001');

    // Verify stock was decremented once (15 - 2 = 13, not 11)
    const prodAfterDup = await ProductModel.findById(productId).lean();
    expect(prodAfterDup?.stock).toBe(13);

    // Now test duplicate replay of an offline due payment
    const dueIdemKey = `idem-due-${shop.tenantId}-replay-01`;
    const duePay1 = await request(app)
      .post(`/api/v1/dues/${saleId}/payments`)
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        idempotencyKey: dueIdemKey,
        amount: 100,
        method: 'bkash',
      });
    expect(duePay1.status).toBe(201);

    const duePay2 = await request(app)
      .post(`/api/v1/dues/${saleId}/payments`)
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        idempotencyKey: dueIdemKey,
        amount: 100,
        method: 'bkash',
      });
    expect(duePay2.status).toBe(200);
    expect(duePay2.body.duplicate).toBe(true);

    // Remaining due must be 280 - 100 = 180 (not 80)
    const updatedSale = await SaleModel.findById(saleId).lean();
    expect(updatedSale?.dueAmount).toBe(180);
  });

  it('9c. Offline sync conflict: a queued offline sale that fails server validation (stock=0) returns 409 INSUFFICIENT_STOCK and does not corrupt stock', async () => {
    const shop = await registerShop({ shopName: 'Conflict Shop', email: 'owner@conflict.bd' });

    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Out of Stock Inhaler',
        category: 'Medicine',
        unit: 'pcs',
        sku: 'CONF-001',
        costPrice: 200,
        sellPrice: 280,
        stock: 0,
      });
    const productId = prodRes.body.data._id as string;

    const failedSync = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        idempotencyKey: `idem-sale-${shop.tenantId}-conflict-01`,
        items: [{ productId, qty: 1 }],
        discount: 0,
        paymentMethod: 'cash',
        paidAmount: 280,
      });

    expect(failedSync.status).toBe(409);
    expect(failedSync.body.error.code).toBe(ERROR_CODES.INSUFFICIENT_STOCK);

    const prodCheck = await ProductModel.findById(productId).lean();
    expect(prodCheck?.stock).toBe(0);
    const salesCount = await SaleModel.countDocuments({ tenantId: shop.tenantId });
    expect(salesCount).toBe(0);
  });

  // 10. Phase 1 (§4.1.4) — SSLCommerz GET browser redirect is read-only
  it('10a & 10c. SSLCommerz GET browser redirect: GET /api/v1/billing/sslcommerz/success?tran_id=... is read-only and does NOT grant Pro without POST validation', async () => {
    const shop = await registerShop({ shopName: 'GET Callback Shop', email: 'owner@getcb.bd' });

    const initRes = await request(app)
      .post('/api/v1/billing/sslcommerz/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({});
    expect(initRes.status).toBe(201);
    const tranId = initRes.body.data.tranId as string;

    const beforePayment = await TenantModel.findById(shop.tenantId).lean();
    const trialEndsMs = new Date(beforePayment!.planExpiresAt!).getTime();

    // Browser GET redirect from SSLCommerz sandbox
    const getCallbackRes = await request(app)
      .get(`/api/v1/billing/sslcommerz/success?tran_id=${encodeURIComponent(tranId)}&val_id=VAL-GET-01`)
      .set('Accept', 'text/html,application/xhtml+xml');

    expect(getCallbackRes.status).toBe(302);
    const location = getCallbackRes.headers['location'] ?? '';
    expect(location).toContain(encodeURIComponent(tranId));

    // Payment MUST remain pending after GET
    const payment = await PaymentModel.findOne({ provider: 'sslcommerz', eventId: tranId }).lean();
    expect(payment?.status).toBe('pending');

    // Tenant Pro expiration must NOT be extended by GET
    const tenantAfterGet = await TenantModel.findById(shop.tenantId).lean();
    expect(new Date(tenantAfterGet!.planExpiresAt!).getTime()).toBe(trialEndsMs);

    // Legitimate server POST callback applies payment
    const postRes = await request(app)
      .post('/api/v1/billing/sslcommerz/success')
      .send({
        tran_id: tranId,
        val_id: 'VAL-GET-01',
        amount: 499,
        currency: 'BDT',
        status: 'VALID',
      });
    expect(postRes.status).toBe(200);

    const paidPayment = await PaymentModel.findOne({ provider: 'sslcommerz', eventId: tranId }).lean();
    expect(paidPayment?.status).toBe('paid');

    const upgradedTenant = await TenantModel.findById(shop.tenantId).lean();
    expect(upgradedTenant?.plan).toBe('pro');
    const daysAdded =
      (new Date(upgradedTenant!.planExpiresAt!).getTime() - trialEndsMs) / (1000 * 60 * 60 * 24);
    expect(daysAdded).toBeGreaterThan(29.5);
    expect(daysAdded).toBeLessThan(30.5);
  });

  it('10b. SSLCommerz GET browser redirect with unknown tran_id returns 404 and changes nothing', async () => {
    const shop = await registerShop({ shopName: 'Unknown Tran Shop', email: 'owner@unk.bd' });

    const before = await TenantModel.findById(shop.tenantId).lean();

    const res = await request(app).get('/api/v1/billing/sslcommerz/success?tran_id=UNKNOWN_TRAN_999');
    expect(res.status).toBe(404);

    const tenant = await TenantModel.findById(shop.tenantId).lean();
    expect(tenant?.plan).toBe(before?.plan);
    expect(new Date(tenant!.planExpiresAt!).toISOString()).toBe(
      new Date(before!.planExpiresAt!).toISOString(),
    );
    expect(new Date(tenant!.trialEndsAt!).toISOString()).toBe(
      new Date(before!.trialEndsAt!).toISOString(),
    );
  });

  // 11. Phase 1 & 4 — End-to-End Payment Proof (SSLCommerz POST IPN + Stripe Verified Webhook)
  it('11. Phase 4 E2E Payment Proof: Trial tenant pays via SSLCommerz POST IPN and Stripe webhook with constructEvent', async () => {
    const shop = await registerShop({
      shopName: 'Phase 4 Sandbox Proof Pharmacy',
      email: 'proof@dokanos.bd',
    });

    // Step 1: Verify initial Pro trial state
    const initialPlanRes = await request(app)
      .get('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(initialPlanRes.status).toBe(200);
    expect(initialPlanRes.body.data.plan).toBe('pro');

    // Step 2: Initiate SSLCommerz Sandbox Checkout
    const initRes = await request(app)
      .post('/api/v1/billing/sslcommerz/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({});
    expect(initRes.status).toBe(201);
    const tranId = initRes.body.data.tranId as string;
    expect(tranId).toMatch(/^DKN-/);

    const pendingPayment = await PaymentModel.findOne({
      provider: 'sslcommerz',
      eventId: tranId,
    }).lean();
    expect(pendingPayment?.status).toBe('pending');
    expect(pendingPayment?.amount).toBe(499);

    // Step 3: Browser GET redirect is purely navigational
    const getSuccessRes = await request(app)
      .get(`/api/v1/billing/sslcommerz/success?tran_id=${encodeURIComponent(tranId)}`)
      .set('Accept', 'text/html');
    expect(getSuccessRes.status).toBe(302);
    expect(getSuccessRes.headers['location']).toContain(encodeURIComponent(tranId));

    // Step 4: Apply payment via server POST /ipn
    const ipnRes = await request(app)
      .post('/api/v1/billing/sslcommerz/ipn')
      .send({
        tran_id: tranId,
        val_id: 'VAL-SANDBOX-PROOF-01',
        amount: 499,
        currency: 'BDT',
        status: 'VALID',
      });
    expect(ipnRes.status).toBe(200);
    expect(ipnRes.body.data.duplicate).toBe(false);

    // Step 5: Verify database state after callback
    const paidPayment = await PaymentModel.findOne({
      provider: 'sslcommerz',
      eventId: tranId,
    }).lean();
    expect(paidPayment?.status).toBe('paid');

    const upgradedTenant = await TenantModel.findById(shop.tenantId).lean();
    expect(upgradedTenant?.plan).toBe('pro');
    expect(upgradedTenant?.planExpiresAt).not.toBeNull();
    const firstExpiresAtIso = new Date(upgradedTenant!.planExpiresAt!).toISOString();

    const activeSub = await SubscriptionModel.findOne({
      tenantId: shop.tenantId,
      provider: 'sslcommerz',
    }).lean();
    expect(activeSub?.status).toBe('active');
    expect(activeSub?.plan).toBe('pro');

    // Step 6: Replay idempotency check via POST /ipn
    const ipnReplay = await request(app)
      .post('/api/v1/billing/sslcommerz/ipn')
      .send({
        tran_id: tranId,
        val_id: 'VAL-SANDBOX-PROOF-01',
        amount: 499,
        currency: 'BDT',
        status: 'VALID',
      });
    expect(ipnReplay.status).toBe(200);
    expect(ipnReplay.body.data.duplicate).toBe(true);

    const tenantAfterReplays = await TenantModel.findById(shop.tenantId).lean();
    expect(new Date(tenantAfterReplays!.planExpiresAt!).toISOString()).toBe(firstExpiresAtIso);

    // Step 7: Test Stripe checkout and verified webhook signature flow
    const stripeInitRes = await request(app)
      .post('/api/v1/billing/stripe/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({ period: 'monthly' });
    expect(stripeInitRes.status).toBe(201);
    const stripeTranId = stripeInitRes.body.data.tranId as string;

    const stripe = new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
    const testWebhookSecret = 'whsec_test_secret_for_tests_1234567890';
    env.STRIPE_WEBHOOK_SECRET = testWebhookSecret;

    const payloadObj = {
      id: 'evt_test_stripe_01',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_01',
          client_reference_id: stripeTranId,
          metadata: { tranId: stripeTranId },
        },
      },
    };
    const payloadStr = JSON.stringify(payloadObj);
    const sigHeader = stripe.webhooks.generateTestHeaderString({
      payload: payloadStr,
      secret: testWebhookSecret,
    });

    const stripeWebhookRes = await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('stripe-signature', sigHeader)
      .send(payloadObj);
    expect(stripeWebhookRes.status).toBe(200);
    expect(stripeWebhookRes.body.data.tranId).toBe(stripeTranId);

    const stripePayment = await PaymentModel.findOne({
      provider: 'stripe',
      eventId: stripeTranId,
    }).lean();
    expect(stripePayment?.status).toBe('paid');
  });

  // 12. Trial provisioning
  it('12. Trial: registration grants a 14-day Pro trial with full Pro limits', async () => {
    const shop = await registerShop({ shopName: 'Trial Shop', email: 'owner@trial.bd' });

    const tenant = await TenantModel.findById(shop.tenantId).lean();
    expect(tenant?.plan).toBe('pro');
    expect(tenant?.trialEndsAt).not.toBeNull();
    expect(new Date(tenant!.trialEndsAt!).toISOString()).toBe(
      new Date(tenant!.planExpiresAt!).toISOString(),
    );
    const trialDays =
      (new Date(tenant!.planExpiresAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(trialDays).toBeGreaterThan(13.5);
    expect(trialDays).toBeLessThan(14.5);

    const planRes = await request(app)
      .get('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(planRes.status).toBe(200);
    expect(planRes.body.data.plan).toBe('pro');
    expect(planRes.body.data.trialEndsAt).toBe(planRes.body.data.planExpiresAt);
    expect(planRes.body.data.limits.maxProducts).toBeNull(); // Pro: unlimited
  });

  // 13. Annual billing via SSLCommerz
  it('13. Annual: SSLCommerz annual init charges ৳4,200 and extends 365 days from trial end', async () => {
    const shop = await registerShop({ shopName: 'Annual Shop', email: 'owner@annual.bd' });

    const initRes = await request(app)
      .post('/api/v1/billing/sslcommerz/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({ period: 'annual' });
    expect(initRes.status).toBe(201);
    expect(initRes.body.data.amount).toBe(4200);
    expect(initRes.body.data.period).toBe('annual');
    const tranId = initRes.body.data.tranId as string;

    const pendingPayment = await PaymentModel.findOne({
      provider: 'sslcommerz',
      eventId: tranId,
    }).lean();
    expect(pendingPayment?.amount).toBe(4200);

    const beforePayment = await TenantModel.findById(shop.tenantId).lean();
    const trialEndsMs = new Date(beforePayment!.planExpiresAt!).getTime();

    const cb = await request(app).post('/api/v1/billing/sslcommerz/ipn').send({
      tran_id: tranId,
      val_id: 'VAL-ANNUAL-01',
      amount: 4200,
      currency: 'BDT',
      status: 'VALID',
    });
    expect(cb.status).toBe(200);
    expect(cb.body.data.duplicate).toBe(false);

    const tenant = await TenantModel.findById(shop.tenantId).lean();
    expect(tenant?.plan).toBe('pro');
    expect(tenant?.trialEndsAt).toBeNull();
    const daysAdded = (new Date(tenant!.planExpiresAt!).getTime() - trialEndsMs) / (1000 * 60 * 60 * 24);
    expect(daysAdded).toBeGreaterThan(364.5);
    expect(daysAdded).toBeLessThan(365.5);
  });

  // 14. Annual billing via Stripe test mode
  it('14. Annual: Stripe annual checkout charges ৳4,200 and extends 365 days from trial end', async () => {
    const shop = await registerShop({ shopName: 'Stripe Annual Shop', email: 'owner@stripe.bd' });

    const initRes = await request(app)
      .post('/api/v1/billing/stripe/checkout')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({ period: 'annual' });
    expect(initRes.status).toBe(201);
    expect(initRes.body.data.amount).toBe(4200);
    const tranId = initRes.body.data.tranId as string;

    const beforePayment = await TenantModel.findById(shop.tenantId).lean();
    const trialEndsMs = new Date(beforePayment!.planExpiresAt!).getTime();

    const stripe = new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
    const webhookSecret = 'whsec_test_secret_for_tests_1234567890';
    env.STRIPE_WEBHOOK_SECRET = webhookSecret;

    const payloadObj = {
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${Date.now()}`,
          client_reference_id: tranId,
          metadata: { tranId },
        },
      },
    };
    const payloadStr = JSON.stringify(payloadObj);
    const sigHeader = stripe.webhooks.generateTestHeaderString({
      payload: payloadStr,
      secret: webhookSecret,
    });

    const hook = await request(app)
      .post('/api/v1/billing/stripe/webhook')
      .set('stripe-signature', sigHeader)
      .send(payloadObj);
    expect(hook.status).toBe(200);

    const tenant = await TenantModel.findById(shop.tenantId).lean();
    expect(tenant?.plan).toBe('pro');
    expect(tenant?.trialEndsAt).toBeNull();
    const daysAdded = (new Date(tenant!.planExpiresAt!).getTime() - trialEndsMs) / (1000 * 60 * 60 * 24);
    expect(daysAdded).toBeGreaterThan(364.5);
    expect(daysAdded).toBeLessThan(365.5);
  });

  // 15. Trial expiry is enforced by the tenant middleware
  it('15. Trial expiry: an expired Pro trial is treated as free on the plan endpoint', async () => {
    const shop = await registerShop({ shopName: 'Expired Trial Shop', email: 'owner@expired.bd' });

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await TenantModel.findByIdAndUpdate(shop.tenantId, {
      $set: { planExpiresAt: past, trialEndsAt: past },
    });

    const planRes = await request(app)
      .get('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(planRes.status).toBe(200);
    expect(planRes.body.data.plan).toBe('free');
    expect(planRes.body.data.limits.maxProducts).toBe(100);
  });

  // 16. Period validation
  it('16. Billing: an unknown period is rejected with 400, never silently billed monthly', async () => {
    const shop = await registerShop({ shopName: 'Bad Period Shop', email: 'owner@badperiod.bd' });

    const res = await request(app)
      .post('/api/v1/billing/sslcommerz/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({ period: 'yearly' });
    expect(res.status).toBe(400);
  });

  // 17. Auth normalization (Codex review on PR #14)
  it('17. Auth: expired-trial sign-in, /me, and refresh return effective free, not stored pro', async () => {
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        shopName: 'Expired Auth Shop',
        shopType: 'pharmacy',
        ownerName: 'Expired Auth Shop Owner',
        email: 'owner@expiredauth.bd',
        password: 'ExpiredAuth123!',
      });
    expect(regRes.status).toBe(201);
    const tenantId = regRes.body.tenant.id as string;

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await TenantModel.findByIdAndUpdate(tenantId, {
      $set: { planExpiresAt: past, trialEndsAt: past },
    });

    // The stored row still says pro: normalization happens in responses, not the DB.
    const stored = await TenantModel.findById(tenantId).lean();
    expect(stored?.plan).toBe('pro');

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: 'owner@expiredauth.bd',
      password: 'ExpiredAuth123!',
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.tenant.plan).toBe('free');

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken as string}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.tenant.plan).toBe('free');

    const loginCookies = loginRes.headers['set-cookie'];
    const rawCookie = Array.isArray(loginCookies) ? loginCookies[0] : loginCookies;
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', rawCookie);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.tenant.plan).toBe('free');
  });

  // 18. Phase 2 — Real Checkout Init with Customer Contact Fields
  it('18. Phase 2 Billing: SSLCommerz checkout init accepts and stores customer contact fields', async () => {
    const shop = await registerShop({
      shopName: 'Contact Checkout Pharmacy',
      email: 'contact@dokanos.bd',
    });

    const initRes = await request(app)
      .post('/api/v1/billing/sslcommerz/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        period: 'annual',
        phone: '01712345678',
        address: 'House 5, Road 10, Banani',
        city: 'Dhaka',
      });

    expect(initRes.status).toBe(201);
    expect(initRes.body.data.amount).toBe(4200);
    expect(initRes.body.data.period).toBe('annual');
    const tranId = initRes.body.data.tranId as string;

    const payment = await PaymentModel.findOne({ provider: 'sslcommerz', eventId: tranId }).lean();
    expect(payment).not.toBeNull();
    expect(payment?.amount).toBe(4200);
    const raw = payment?.raw as { customerInfo?: { phone?: string; address?: string; city?: string } };
    expect(raw.customerInfo?.phone).toBe('01712345678');
    expect(raw.customerInfo?.address).toBe('House 5, Road 10, Banani');
    expect(raw.customerInfo?.city).toBe('Dhaka');
  });

  // 19. Phase 2 — Reconciliation Job
  it('19. Phase 2 Reconciliation: POST /api/v1/billing/reconcile marks stale pending payments older than 30m as failed', async () => {
    const shop = await registerShop({
      shopName: 'Reconciliation Pharmacy',
      email: 'reconcile@dokanos.bd',
    });

    // Create a stale pending payment created 45 minutes ago
    const staleTranId = `DKN-STALE-${Date.now()}`;
    const fortyFiveMinsAgo = new Date(Date.now() - 45 * 60 * 1000);
    await PaymentModel.create({
      tenantId: shop.tenantId,
      provider: 'sslcommerz',
      providerRef: staleTranId,
      eventId: staleTranId,
      amount: 499,
      currency: 'BDT',
      status: 'pending',
      purpose: 'subscription',
      createdAt: fortyFiveMinsAgo,
    });

    // Create a fresh pending payment created 5 minutes ago
    const freshTranId = `DKN-FRESH-${Date.now()}`;
    await PaymentModel.create({
      tenantId: shop.tenantId,
      provider: 'sslcommerz',
      providerRef: freshTranId,
      eventId: freshTranId,
      amount: 499,
      currency: 'BDT',
      status: 'pending',
      purpose: 'subscription',
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    const reconcileRes = await request(app)
      .post('/api/v1/billing/reconcile')
      .set('Authorization', `Bearer ${shop.accessToken}`);

    expect(reconcileRes.status).toBe(200);
    expect(reconcileRes.body.data.expired).toBeGreaterThanOrEqual(1);

    const stalePayment = await PaymentModel.findOne({ eventId: staleTranId }).lean();
    expect(stalePayment?.status).toBe('failed');

    const freshPayment = await PaymentModel.findOne({ eventId: freshTranId }).lean();
    expect(freshPayment?.status).toBe('pending');
  });

  // 20. Phase 3 — H2 Bug Verification (Codex P2)
  it('20. Phase 3 H2: Expired trial tenant does NOT receive Pro low-stock email digest', async () => {
    const shop = await registerShop({
      shopName: 'H2 Expired Digest Pharmacy',
      email: 'h2@dokanos.bd',
    });

    // Seed a low-stock product
    await ProductModel.create({
      tenantId: shop.tenantId,
      name: 'Napa 500mg',
      category: 'Medicine',
      unit: 'pcs',
      sku: 'H2-NAPA-01',
      costPrice: 10,
      sellPrice: 15,
      stock: 2,
      lowStockAt: 10,
      isActive: true,
    });

    // Set trial expiration to 2 days in the past (stored plan still says pro)
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await TenantModel.findByIdAndUpdate(shop.tenantId, {
      $set: { plan: 'pro', planExpiresAt: pastDate, trialEndsAt: pastDate },
    });

    const summary = await executeJobForTenant('low-stock-digest', shop.tenantId);
    expect(summary).toContain('Free plan - email skipped');

    // In-app alert was still created
    const notifs = await NotificationModel.find({ tenantId: shop.tenantId, type: 'low_stock' });
    expect(notifs.length).toBeGreaterThanOrEqual(1);

    // Now test with active Pro plan
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await TenantModel.findByIdAndUpdate(shop.tenantId, {
      $set: { plan: 'pro', planExpiresAt: futureDate, trialEndsAt: null },
    });

    const proSummary = await executeJobForTenant('low-stock-digest', shop.tenantId);
    expect(proSummary).toContain('Pro digest sent');
  });

  // 21. Phase 3 — Subscription Expiry Job (H1, H2)
  it('21. Phase 3 Subscription Expiry: Downgrades stored row to free plan when expired, sends reminder when expiring in 3 days', async () => {
    const shop = await registerShop({
      shopName: 'Expiry Test Pharmacy',
      email: 'expiry@dokanos.bd',
    });

    // Case A: Expiring in 2 days (within 3-day reminder window)
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await TenantModel.findByIdAndUpdate(shop.tenantId, {
      $set: { plan: 'pro', planExpiresAt: inTwoDays },
    });

    const reminderSummary = await executeJobForTenant('subscription-expiry', shop.tenantId);
    expect(reminderSummary).toContain('Sent expiry reminder');

    const reminderNotif = await NotificationModel.findOne({
      tenantId: shop.tenantId,
      type: 'subscription',
      title: /Expiring in 2 days/,
    });
    expect(reminderNotif).not.toBeNull();

    // Case B: Expired trial/subscription
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await TenantModel.findByIdAndUpdate(shop.tenantId, {
      $set: { plan: 'pro', planExpiresAt: pastDate, trialEndsAt: pastDate },
    });

    const expiredSummary = await executeJobForTenant('subscription-expiry', shop.tenantId);
    expect(expiredSummary).toContain('Downgraded');

    // Stored row MUST now say free in DB (stopped lying)
    const storedTenant = await TenantModel.findById(shop.tenantId).lean();
    expect(storedTenant?.plan).toBe('free');
    expect(storedTenant?.planExpiresAt).toBeNull();

    const expiredNotif = await NotificationModel.findOne({
      tenantId: shop.tenantId,
      type: 'subscription',
      title: /Subscription Expired/,
    });
    expect(expiredNotif).not.toBeNull();
  });

  // 22. Phase 3 — External Cron Endpoint
  it('22. Phase 3 External Cron: POST /api/v1/admin/jobs/cron/run with service credential executes jobs', async () => {
    await registerShop({
      shopName: 'Cron Target Shop',
      email: 'cron@dokanos.bd',
    });

    // Unauthenticated call with invalid secret returns 401
    const unauthRes = await request(app)
      .post('/api/v1/admin/jobs/cron/run')
      .set('x-cron-secret', 'wrong-secret-123');
    expect(unauthRes.status).toBe(401);

    // Call with valid secret executes successfully
    const authRes = await request(app)
      .post('/api/v1/admin/jobs/cron/run')
      .set('x-cron-secret', env.JWT_ACCESS_SECRET);
    expect(authRes.status).toBe(200);
    expect(authRes.body.ok).toBe(true);
    expect(authRes.body.jobs.length).toBe(3);
  });

  // 23. Phase 4 — Password Recovery Flow (forgot-password, reset-password, change-password)
  it('23. Phase 4 Password Recovery: forgot-password sets token hash, reset-password updates password and revokes sessions, change-password requires current password', async () => {
    const _shop = await registerShop({
      shopName: 'Recovery Shop',
      email: 'recovery@dokanos.bd',
    });

    // 1. forgot-password
    const forgotRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'recovery@dokanos.bd' });
    expect(forgotRes.status).toBe(200);

    const user = await UserModel.findOne({ email: 'recovery@dokanos.bd' });
    expect(user?.resetPasswordTokenHash).toBeDefined();
    expect(user?.resetPasswordExpiresAt).toBeDefined();

    // 2. reset-password with invalid token
    const invalidReset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'wrong-token-abc', newPassword: 'NewPassword123!' });
    expect(invalidReset.status).toBe(400);

    // Known raw token and hash for deterministic test
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const resetHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    await UserModel.updateOne(
      { email: 'recovery@dokanos.bd' },
      {
        $set: {
          resetPasswordTokenHash: resetHash,
          resetPasswordExpiresAt: new Date(Date.now() + 3600000),
        },
      },
    );

    // 3. reset-password with valid token
    const validReset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawResetToken, newPassword: 'NewPassword123!' });
    expect(validReset.status).toBe(200);

    // Old password fails, new password succeeds
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'recovery@dokanos.bd', password: 'Password123!' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'recovery@dokanos.bd', password: 'NewPassword123!' });
    expect(newLogin.status).toBe(200);
    const newAccessToken = newLogin.body.accessToken;

    // 4. change-password with wrong current password
    const wrongChange = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .send({ currentPassword: 'WrongPassword!', newPassword: 'ThirdPassword123!' });
    expect(wrongChange.status).toBe(401);

    // 5. change-password with correct current password
    const validChange = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .send({ currentPassword: 'NewPassword123!', newPassword: 'ThirdPassword123!' });
    expect(validChange.status).toBe(200);

    const thirdLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'recovery@dokanos.bd', password: 'ThirdPassword123!' });
    expect(thirdLogin.status).toBe(200);
  });

  // 24. Phase 4 — Secure Staff Invites with Hashed Token (C4)
  it('24. Phase 4 Invites: Staff invited without password has unusable password, can only activate via accept-invite with unexpired token', async () => {
    const shop = await registerShop({
      shopName: 'Invite Test Pharmacy',
      email: 'owner@invite-test.bd',
    });

    const inviteRes = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Trainee Staff',
        email: 'trainee@invite-test.bd',
        role: 'staff',
      });
    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.data.setupLink).toContain('/accept-invite?token=');

    const invitedUser = await UserModel.findOne({ email: 'trainee@invite-test.bd' });
    expect(invitedUser?.status).toBe('invited');
    expect(invitedUser?.passwordHash).toBe('*');
    expect(invitedUser?.inviteTokenHash).toBeDefined();

    // Cannot log in with default 'Staff1234!' or anything
    const unacceptedLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'trainee@invite-test.bd', password: 'Staff1234!' });
    expect(unacceptedLogin.status).toBe(401);

    // Accept invite with invalid token fails
    const badAccept = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ inviteToken: 'invalid-token-12345', password: 'ChosenPassword123!' });
    expect(badAccept.status).toBe(400);

    // Accept invite with valid token succeeds
    const tokenMatch = inviteRes.body.data.setupLink.match(/token=([a-f0-9]+)/);
    expect(tokenMatch).not.toBeNull();
    const rawInviteToken = tokenMatch![1];
    const goodAccept = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ inviteToken: rawInviteToken, password: 'ChosenPassword123!' });
    expect(goodAccept.status).toBe(200);
    expect(goodAccept.body.accessToken).toBeDefined();
    expect(goodAccept.body.user.role).toBe('staff');

    const activatedUser = await UserModel.findOne({ email: 'trainee@invite-test.bd' });
    expect(activatedUser?.status).toBe('active');
    expect(activatedUser?.inviteTokenHash).toBeNull();

    // Replay attack with same token fails
    const replayAccept = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ inviteToken: rawInviteToken, password: 'AnotherPassword123!' });
    expect(replayAccept.status).toBe(400);
  });

  // 25. Phase 4 — Tenant Login Isolation & Wrong Slug 404 (H3)
  it('25. Phase 4 Tenant Isolation: Login with nonexistent tenantSlug returns 404 Shop Not Found', async () => {
    await registerShop({
      shopName: 'Tenant Iso Pharmacy',
      email: 'iso@dokanos.bd',
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'iso@dokanos.bd',
        password: 'Password123!',
        tenantSlug: 'non-existent-shop-slug-999',
      });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Shop not found');
  });

  // 26. Phase 4 — Active Session Revocation on Status Disable
  it('26. Phase 4 Token Revocation: Disabling a user revokes all active refresh tokens immediately', async () => {
    const shop = await registerShop({
      shopName: 'Revocation Pharmacy',
      email: 'owner@revocation.bd',
    });

    const inviteRes = await request(app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Staff Revoke',
        email: 'staff@revocation.bd',
        role: 'staff',
      });
    const revokeTokenMatch = inviteRes.body.data.setupLink.match(/token=([a-f0-9]+)/);
    expect(revokeTokenMatch).not.toBeNull();
    const token = revokeTokenMatch![1];

    const acceptRes = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ inviteToken: token, password: 'StaffPassword123!' });
    expect(acceptRes.status).toBe(200);

    const cookies = acceptRes.headers['set-cookie'];
    const staffCookie = (Array.isArray(cookies) ? cookies[0] : cookies) ?? '';
    expect(staffCookie).toContain('dokanos_rt=');

    // Refresh works before being disabled
    const refreshBefore = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', staffCookie);
    expect(refreshBefore.status).toBe(200);
    const refreshedCookie = (Array.isArray(refreshBefore.headers['set-cookie'])
      ? refreshBefore.headers['set-cookie'][0]
      : refreshBefore.headers['set-cookie']) ?? '';

    // Owner disables staff account
    const staffId = acceptRes.body.user.id;
    const disableRes = await request(app)
      .patch(`/api/v1/users/${staffId}/status`)
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({ status: 'disabled' });
    expect(disableRes.status).toBe(200);

    // Refresh immediately fails 401
    const refreshAfter = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshedCookie);
    expect(refreshAfter.status).toBe(401);
  });

  // 27. Phase 4 — Notification Scoping & 404
  it('27. Phase 4 Notification Scoping: Reading notification of another user returns 404, nonexistent returns 404', async () => {
    const shop = await registerShop({
      shopName: 'Notif Shop',
      email: 'notif@dokanos.bd',
    });

    const otherUserId = new mongoose.Types.ObjectId();
    const otherUserNotif = await NotificationModel.create({
      tenantId: shop.tenantId,
      userId: otherUserId,
      type: 'low_stock',
      title: 'Private Alert',
      body: 'Private message for other user',
      link: '/app/alerts',
      isRead: false,
    });

    // Owner tries to mark another user's targeted notification as read
    const readRes = await request(app)
      .patch(`/api/v1/notifications/${otherUserNotif._id}/read`)
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(readRes.status).toBe(404);

    // Nonexistent notification ID returns 404
    const nonExistentId = new mongoose.Types.ObjectId();
    const notFoundRes = await request(app)
      .patch(`/api/v1/notifications/${nonExistentId}/read`)
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(notFoundRes.status).toBe(404);
  });

  // 28. Phase 5 — Stock Ledger Hardening & Supplier Scoping
  it('28. Phase 5 Stock Hardening: direct stock update via PATCH /products/:id is rejected with 400, supplierId must belong to tenant', async () => {
    const shop1 = await registerShop({
      shopName: 'Stock Shop 1',
      email: 'stock1@dokanos.bd',
    });
    const shop2 = await registerShop({
      shopName: 'Stock Shop 2',
      email: 'stock2@dokanos.bd',
    });

    // Create supplier in shop2
    const sup2 = await SupplierModel.create({
      tenantId: shop2.tenantId,
      name: 'Shop 2 Supplier',
      phone: '01700000002',
    });

    // Create product in shop1 with initial stock 50
    const prodRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${shop1.accessToken}`)
      .send({
        name: 'Paracetamol 500mg',
        category: 'Medicine',
        unit: 'pcs',
        costPrice: 5,
        sellPrice: 10,
        stock: 50,
        sku: 'PARA-500',
      });
    expect(prodRes.status).toBe(201);
    const prodId = prodRes.body.data._id;

    // 1. Attempt direct stock modification via PATCH /products/:id
    const directStockPatch = await request(app)
      .patch(`/api/v1/products/${prodId}`)
      .set('Authorization', `Bearer ${shop1.accessToken}`)
      .send({ stock: 200 });
    expect(directStockPatch.status).toBe(400);
    expect(directStockPatch.body.error.code).toBe(ERROR_CODES.VALIDATION);
    expect(directStockPatch.body.error.message).toContain('Stock cannot be modified directly');

    // Verify stock is still 50
    const fetchedProd = await ProductModel.findById(prodId);
    expect(fetchedProd?.stock).toBe(50);

    // 2. Attempt assigning supplier belonging to another tenant
    const foreignSupPatch = await request(app)
      .patch(`/api/v1/products/${prodId}`)
      .set('Authorization', `Bearer ${shop1.accessToken}`)
      .send({ supplierId: sup2._id.toString() });
    expect(foreignSupPatch.status).toBe(404);
    expect(foreignSupPatch.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(foreignSupPatch.body.error.message).toContain('Supplier not found in this shop');
  });

  // 29. Phase 5 — Purchase Cost Change Audit
  it('29. Phase 5 Purchase Cost Audit: cost price changes trigger product.cost_changed audit log and purchase.created', async () => {
    const shop = await registerShop({
      shopName: 'Purchase Audit Shop',
      email: 'purchaseaudit@dokanos.bd',
    });

    const supplier = await SupplierModel.create({
      tenantId: shop.tenantId,
      name: 'Square Distributor',
      phone: '01711223399',
    });

    const prod = await ProductModel.create({
      tenantId: shop.tenantId,
      name: 'Napa Extra',
      category: 'Medicine',
      unit: 'pcs',
      costPrice: 10,
      sellPrice: 15,
      stock: 20,
      sku: 'NAPA-EXTRA',
    });

    // Purchase with higher cost price: 12
    const purchaseRes = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        supplierId: supplier._id.toString(),
        items: [
          {
            productId: prod._id.toString(),
            name: prod.name,
            qty: 10,
            costPrice: 12,
            lineTotal: 120,
          },
        ],
        total: 120,
        paidAmount: 120,
      });
    expect(purchaseRes.status).toBe(201);

    // Verify product costPrice was updated to 12
    const updatedProd = await ProductModel.findById(prod._id);
    expect(updatedProd?.costPrice).toBe(12);

    // Verify cost_changed audit log entry
    const costAudit = await AuditLogModel.findOne({
      tenantId: shop.tenantId,
      action: 'product.cost_changed',
    });
    expect(costAudit).not.toBeNull();
    expect(costAudit?.changes.oldCostPrice).toBe(10);
    expect(costAudit?.changes.newCostPrice).toBe(12);

    // Verify purchase.created audit log
    const purchaseAudit = await AuditLogModel.findOne({
      tenantId: shop.tenantId,
      action: 'purchase.created',
    });
    expect(purchaseAudit).not.toBeNull();
  });

  // 30. Phase 5 — Baki Sale Customer Validation & Balance Tracking
  it('30. Phase 5 Baki Customer Validation: Baki sale requires customer name, creates customer and tracks due balance', async () => {
    const shop = await registerShop({
      shopName: 'Baki Shop',
      email: 'baki@dokanos.bd',
    });

    const prod = await ProductModel.create({
      tenantId: shop.tenantId,
      name: 'Insulin Pen',
      category: 'Medicine',
      unit: 'pcs',
      costPrice: 500,
      sellPrice: 750,
      stock: 10,
      sku: 'INS-PEN',
    });

    // 1. Baki sale without customer name -> 400
    const bakiNoCustomer = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        items: [
          {
            productId: prod._id.toString(),
            name: prod.name,
            qty: 1,
            unitPrice: 750,
            lineTotal: 750,
          },
        ],
        total: 750,
        paidAmount: 250, // Due 500
        paymentMethod: 'cash',
      });
    expect(bakiNoCustomer.status).toBe(400);
    expect(bakiNoCustomer.body.error.code).toBe(ERROR_CODES.VALIDATION);
    expect(bakiNoCustomer.body.error.message).toContain('Customer name is required');

    // 2. Baki sale with customer name and phone
    const bakiWithCustomer = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        customerName: 'Hafizur Rahman',
        customerPhone: '01899112233',
        items: [
          {
            productId: prod._id.toString(),
            name: prod.name,
            qty: 1,
            unitPrice: 750,
            lineTotal: 750,
          },
        ],
        total: 750,
        paidAmount: 250,
        paymentMethod: 'cash',
      });
    expect(bakiWithCustomer.status).toBe(201);
    expect(bakiWithCustomer.body.data.dueAmount).toBe(500);
    expect(bakiWithCustomer.body.data.customerId).toBeDefined();

    // Verify Customer record created with balances
    const customer = await CustomerModel.findOne({
      tenantId: shop.tenantId,
      phone: '01899112233',
    });
    expect(customer).not.toBeNull();
    expect(customer?.name).toBe('Hafizur Rahman');
    expect(customer?.balanceDue).toBe(500);
    expect(customer?.totalSpent).toBe(750);
  });

  // 31. Phase 5 — Customers CRUD & History
  it('31. Phase 5 Customers CRUD: create, list, inspect with history, update customer', async () => {
    const shop = await registerShop({
      shopName: 'Customer CRUD Shop',
      email: 'customers@dokanos.bd',
    });

    // 1. Create customer
    const createRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Kamal Hossain',
        phone: '01722334455',
        address: 'Uttara Sector 3, Dhaka',
        notes: 'VIP customer',
      });
    expect(createRes.status).toBe(201);
    const customerId = createRes.body.data._id;

    // 2. List customers with search
    const listRes = await request(app)
      .get('/api/v1/customers?search=Kamal')
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.meta.total).toBe(1);

    // 3. Inspect customer details with sales and dues
    const detailRes = await request(app)
      .get(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.name).toBe('Kamal Hossain');
    expect(Array.isArray(detailRes.body.data.sales)).toBe(true);
    expect(Array.isArray(detailRes.body.data.openDues)).toBe(true);

    // 4. Update customer
    const updateRes = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        address: 'Uttara Sector 7, Dhaka',
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.address).toBe('Uttara Sector 7, Dhaka');
  });

  // 32. Phase 5 — Suppliers Edit & Soft-Delete
  it('32. Phase 5 Suppliers: pagination, editing and soft deletion exclude supplier from active queries', async () => {
    const shop = await registerShop({
      shopName: 'Supplier Management Shop',
      email: 'supmgmt@dokanos.bd',
    });

    const sup1 = await SupplierModel.create({
      tenantId: shop.tenantId,
      name: 'Incepta Pharma',
      phone: '01711001122',
    });

    const sup2 = await SupplierModel.create({
      tenantId: shop.tenantId,
      name: 'Renata Ltd',
      phone: '01711003344',
    });

    // 1. List suppliers with pagination
    const listRes = await request(app)
      .get('/api/v1/suppliers?limit=10')
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(2);
    expect(listRes.body.meta.total).toBe(2);

    // 2. Edit supplier
    const editRes = await request(app)
      .patch(`/api/v1/suppliers/${sup1._id}`)
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({
        name: 'Incepta Pharmaceuticals PLC',
        address: 'Tejgaon I/A, Dhaka',
      });
    expect(editRes.status).toBe(200);
    expect(editRes.body.data.name).toBe('Incepta Pharmaceuticals PLC');

    // 3. Soft-delete supplier
    const delRes = await request(app)
      .delete(`/api/v1/suppliers/${sup2._id}`)
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);
    const softDeleted = await SupplierModel.findById(sup2._id);
    expect(softDeleted?.isActive).toBe(false);

    // 4. List suppliers now excludes soft-deleted supplier
    const listAfter = await request(app)
      .get('/api/v1/suppliers')
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(listAfter.status).toBe(200);
    expect(listAfter.body.data.length).toBe(1);
    expect(listAfter.body.data[0].name).toBe('Incepta Pharmaceuticals PLC');
  });
});
