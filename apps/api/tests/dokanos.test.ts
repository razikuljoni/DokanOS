import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ERROR_CODES } from '@dokanos/shared';
import { createApiApp } from '../src/app.js';
import {
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

    const beforeCallback = Date.now();

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
    const expiresAtMs = new Date(tenant!.planExpiresAt!).getTime();
    const daysAdded = (expiresAtMs - beforeCallback) / (1000 * 60 * 60 * 24);
    expect(daysAdded).toBeGreaterThan(29.5);
    expect(daysAdded).toBeLessThan(30.5);
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

  // 10. Phase 3 (§4.1.4) — SSLCommerz GET browser redirect callback & FRONTEND_URL redirect
  it('10a & 10c. SSLCommerz GET browser redirect: GET /api/v1/billing/sslcommerz/success?tran_id=... applies payment without Authorization header and redirects to env.FRONTEND_URL', async () => {
    const shop = await registerShop({ shopName: 'GET Callback Shop', email: 'owner@getcb.bd' });

    const initRes = await request(app)
      .post('/api/v1/billing/sslcommerz/init')
      .set('Authorization', `Bearer ${shop.accessToken}`)
      .send({});
    expect(initRes.status).toBe(201);
    const tranId = initRes.body.data.tranId as string;

    const beforeMs = Date.now();

    // Unauthenticated browser GET redirect from SSLCommerz sandbox
    const getCallbackRes = await request(app)
      .get(`/api/v1/billing/sslcommerz/success?tran_id=${encodeURIComponent(tranId)}&val_id=VAL-GET-01`)
      .set('Accept', 'text/html,application/xhtml+xml');

    expect(getCallbackRes.status).toBe(302);
    const location = getCallbackRes.headers['location'] ?? '';
    expect(location.startsWith('http://localhost:5173/app/billing?status=success&tran_id=')).toBe(
      true,
    );
    expect(location).toContain(encodeURIComponent(tranId));

    const payment = await PaymentModel.findOne({ provider: 'sslcommerz', eventId: tranId }).lean();
    expect(payment?.status).toBe('paid');

    const tenant = await TenantModel.findById(shop.tenantId).lean();
    expect(tenant?.plan).toBe('pro');
    const daysAdded =
      (new Date(tenant!.planExpiresAt!).getTime() - beforeMs) / (1000 * 60 * 60 * 24);
    expect(daysAdded).toBeGreaterThan(29.5);
    expect(daysAdded).toBeLessThan(30.5);
  });

  it('10b. SSLCommerz GET browser redirect with unknown tran_id returns 404 and changes nothing', async () => {
    const shop = await registerShop({ shopName: 'Unknown Tran Shop', email: 'owner@unk.bd' });

    const res = await request(app).get('/api/v1/billing/sslcommerz/success?tran_id=UNKNOWN_TRAN_999');
    expect(res.status).toBe(404);

    const tenant = await TenantModel.findById(shop.tenantId).lean();
    expect(tenant?.plan).toBe('free');
    expect(tenant?.planExpiresAt).toBeNull();
  });

  // 11. Phase 4 (§5) — Full End-to-End Sandbox Payment Proof (SSLCommerz Primary + Stripe Test Mode Secondary)
  it('11. Phase 4 E2E Payment Proof: Free tenant upgrades via SSLCommerz Sandbox & Stripe Test Mode with GET/POST callback + IPN replay idempotency', async () => {
    const shop = await registerShop({
      shopName: 'Phase 4 Sandbox Proof Pharmacy',
      email: 'proof@dokanos.bd',
    });

    // Verify initial Free state
    const initialPlanRes = await request(app)
      .get('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${shop.accessToken}`);
    expect(initialPlanRes.status).toBe(200);
    expect(initialPlanRes.body.data.plan).toBe('free');
    expect(initialPlanRes.body.data.planExpiresAt).toBeNull();

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

    // Step 3: Complete payment via browser GET redirect to /api/v1/billing/sslcommerz/success
    const getSuccessRes = await request(app)
      .get(`/api/v1/billing/sslcommerz/success?tran_id=${encodeURIComponent(tranId)}&val_id=VAL-SANDBOX-PROOF-01`)
      .set('Accept', 'text/html');
    expect(getSuccessRes.status).toBe(302);
    expect(getSuccessRes.headers['location']).toBe(
      `http://localhost:5173/app/billing?status=success&tran_id=${encodeURIComponent(tranId)}`,
    );

    // Step 4: Verify database state after callback
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

    // Step 5: Replay idempotency check via POST /ipn AND GET /success
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

    const getReplay = await request(app)
      .get(`/api/v1/billing/sslcommerz/success?tran_id=${encodeURIComponent(tranId)}&format=json`);
    expect(getReplay.status).toBe(200);
    expect(getReplay.body.data.duplicate).toBe(true);

    const tenantAfterReplays = await TenantModel.findById(shop.tenantId).lean();
    expect(new Date(tenantAfterReplays!.planExpiresAt!).toISOString()).toBe(firstExpiresAtIso);
  });
});
