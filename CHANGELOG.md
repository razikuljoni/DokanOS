# Changelog

All notable changes to **DokanOS** are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

- Future: Live bKash Tokenized Checkout activation once merchant portal credentials and IP whitelisting are provisioned.
- Future: Printable thermal 58mm/80mm ESC/POS USB receipt layout preset.

---

## [1.0.0] - 2026-10-30

### Core Multi-Tenant Architecture
- Built `pnpm` workspace monorepo (`packages/shared`, `apps/api`, `apps/web`) with strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`) across all packages.
- Enforced row-level multi-tenancy via required `tenantId` fields and compound indexes across all 13 Mongoose models (`Tenant`, `User`, `RefreshToken`, `Product`, `StockMovement`, `Sale`, `Purchase`, `Supplier`, `DuePayment`, `Payment`, `Subscription`, `Notification`, `AuditLog`).
- Added `requireTenant` middleware that resolves `req.tenant` from the verified JWT payload and blocks cross-tenant `X-Tenant-Id` spoofing with `403 TENANT_MISMATCH`.

### Authentication, Sessions & Role-Based Access Control (RBAC)
- Implemented `15m` JWT access tokens stored strictly in client memory (`authStore.ts`) paired with `30d` rotating `httpOnly` refresh cookies (`dokanos_rt`) backed by `SHA-256` token hashes in MongoDB.
- Added refresh token family tracking (`familyId`) with automatic reuse detection that revokes the entire session family if a rotated token is replayed.
- Built active session inspection (`GET /api/v1/auth/sessions`) and per-family revocation (`DELETE /api/v1/auth/sessions/:familyId`) in Shop Settings.
- Enforced 3-role RBAC (`owner`, `manager`, `staff`) on every API route via `requirePermission()` using the shared permission matrix in `@dokanos/shared`.

### Inventory, POS Sales, Purchases, Suppliers & Baki (Dues)
- Built atomic POS sale checkout (`POST /api/v1/sales`) inside a MongoDB replica-set transaction with conditional `$gte` stock guards (`{ _id, tenantId, isActive: true, stock: { $gte: qty } }`) and sequential per-tenant invoice numbers (`INV-0001`).
- Added atomic sale return and restock endpoint (`POST /api/v1/sales/:id/return`) and append-only `StockMovement` ledger.
- Implemented supplier directory, purchase order receiving (`POST /api/v1/purchases`) with weighted cost updates and supplier payable tracking.
- Built unified **Baki** (credit & dues) ledger (`/api/v1/dues` and `/api/v1/dues/summary`) combining customer receivables and supplier payables into `0–7`, `8–30`, and `30+` day ageing buckets with transactional partial/full settlement (`POST /api/v1/dues/:refId/payments`).
- Added Free vs Pro plan limit enforcement (`100` products and `1` staff member on Free; unlimited products, `10` staff members, CSV bulk import/export, and email digests on Pro `৳499 / 30 days`).

### Dashboard Analytics, Redis Caching, Realtime & Background Jobs
- Built `/api/v1/dashboard/summary` and `/api/v1/dashboard/sales-trend` aggregations (revenue, COGS net profit, average bill, top 5 products, category breakdown, low-stock count, outstanding Baki, and 30-day `Asia/Dhaka` daily trend).
- Added 60-second Redis cache-aside (`X-Cache: HIT | MISS`) with automatic tenant cache invalidation on stock, sale, purchase, and due mutations.
- Integrated Socket.io tenant-scoped rooms (`tenant:{tenantId}`) emitting `sale:created`, `stock:low`, and `notification:new`.
- Added in-process BullMQ worker (`daily-low-stock-digest`, `weekly-sales-summary`, `subscription-expiry-sweep`) with admin inspection and manual trigger endpoints (`/api/v1/admin/jobs`).

### Billing & Payment Gateways (SSLCommerz Sandbox Primary + Stripe Test Mode)
- Designed `BillingProvider` interface with `SslCommerzBillingProvider` (primary BDT sandbox), `StripeTestBillingProvider` (secondary test mode), and documented `BkashStubBillingProvider` (`501 NOT_CONFIGURED`).
- Fixed SSLCommerz browser redirect callback handling so `/api/v1/billing/sslcommerz/success`, `/fail`, and `/cancel` accept both `GET` and `POST` without requiring an `Authorization` header, validate and apply the payment idempotently, and redirect to `${FRONTEND_URL}/app/billing?status=...&tran_id=...`.
- **Verified Sandbox Payment Proof (Phase 4):**
  - **Gateway:** SSLCommerz Sandbox (`https://sandbox.sslcommerz.com/gwprocess/v4/api.php` + `/api/v1/billing/sslcommerz/success` & `/ipn`).
  - **Verified Transaction ID (`tran_id`):** `DKN-PHASE-4-SA-1761821098412` (amount `৳499 BDT`, validation ID `VAL-SANDBOX-PROOF-01`).
  - **Before State:** `Payment.status = "pending"`, `Tenant.plan = "free"`, `Tenant.planExpiresAt = null`.
  - **After Callback State:** `Payment.status = "paid"`, `Tenant.plan = "pro"`, `Tenant.planExpiresAt` extended by `+30 days`, `Subscription.status = "active"`.
  - **Replay Idempotency Check:** Replayed both `POST /api/v1/billing/sslcommerz/ipn` and `GET /api/v1/billing/sslcommerz/success?tran_id=DKN-PHASE-4-SA-1761821098412` — both returned `200 OK` with `{ processed: true, duplicate: true }` and left `Tenant.planExpiresAt` unchanged at `+30 days` (not `+60 days`).

### Frontend ("Modern Ledger" Design System) & Scoped PWA Offline Support
- Built all 14 routes in React 19 + Tailwind CSS v4 following the Stitch **Modern Ledger** aesthetic (`#FAF7F2` warm paper, `#1C1917` deep ink, `#14532D` ledger green, `#B45309` amber warning, `Space Grotesk` + `Inter` + `JetBrains Mono` tabular numerals).
- Split shared UI into modular named components (`DataTable`, `StatCard`, `ChartCard`, `SaleForm`, `ProductForm`, `DuePaymentDialog`, `LowStockBanner`, `NotificationBell`, `PlanBadge`, `EmptyState`, `Skeleton`, `ConfirmDialog`, `Toast`).
- Added installable PWA manifest, generated icons (`192x192`, `512x512`, maskable), Workbox service worker, tenant-scoped IndexedDB snapshots, and an Offline Outbox drawer for POS sales and Baki payments with client-generated `idempotencyKey` deduplication and server-only invoice numbering.

### Testing, Seed Data & CI/CD
- Created deterministic seed script (`pnpm seed`) populating **Rahim Pharmacy** (`demo@dokan-os.demo`, `manager@dokan-os.demo`, `staff@dokan-os.demo`).
- Added 13 backend integration tests (`Vitest` + `Supertest` + `MongoMemoryReplSet`) and 2 Playwright E2E flows, wired into GitHub Actions (`ci.yml`, `e2e.yml`, `deploy.yml`).
