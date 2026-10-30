# DokanOS — Multi-Tenant Inventory, POS & Baki Ledger for Bangladeshi Shops

> **One-line pitch:** A multi-tenant inventory, atomic POS sales, and "Baki" credit ledger SaaS built for small pharmacies, groceries, and electronics shops in Bangladesh.

- **Live Preview URL:** `https://ais-pre-uwzzhif7f34c2xnjqyvfzo-447176114440.asia-southeast1.run.app`
- **API Health Endpoint:** `GET /health` → `{ "ok": true }`
- **One-Click Demo Credentials (Rahim Pharmacy — Mirpur-10, Dhaka — Pro Plan):**
  - **Shop Owner:** `demo@dokan-os.demo` / `Demo1234!`
  - **Store Manager:** `manager@dokan-os.demo` / `Demo1234!`
  - **Counter Staff:** `staff@dokan-os.demo` / `Demo1234!`

---

## 1. The Problem & Who It Is For

Across Dhaka and Bangladesh, neighbourhood pharmacies, grocery stores, and electronics shops track thousands of SKUs, rapid cash/bKash counter bills, distributor restocks, and customer credit ("Baki") in paper khata ledgers. During rush hours, paper khatas cannot prevent negative stock, surface low-stock reorder alerts, separate staff counter permissions from owner profit margins, or age overdue customer receivables against supplier payables.

**DokanOS** replaces the paper khata with a fast, tenant-isolated **"Modern Ledger"** web application tailored for Bangladeshi shop owners, managers, and counter staff.

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        dokanos (pnpm workspaces monorepo)                    │
├───────────────────────────┬──────────────────────────┬───────────────────────┤
│      packages/shared      │         apps/web         │        apps/api       │
│  Zod Schemas + z.infer    │  React 19 + Vite 6       │  Express 5 + Node 20  │
│  RBAC Permission Matrix   │  Tailwind v4 + shadcn/ui │  Mongoose 8 (Atlas M0)│
│  Free/Pro Plan Constants  │  TanStack Query v5       │  Socket.io 4 Rooms    │
│  Error Codes & Units      │  Zustand (In-Memory JWT) │  Upstash Redis Cache  │
│                           │  Recharts 3 + Motion 12  │  BullMQ In-Process    │
└─────────────┬─────────────┴────────────┬─────────────┴───────────┬───────────┘
              │                          │                         │
              │      Bearer JWT (15m)    ▼    httpOnly Cookie (30d)│
              └───────────────────► /api/v1/* ◄────────────────────┘
                                         │
          ┌──────────────────────────────┼──────────────────────────────┐
          ▼                              ▼                              ▼
┌───────────────────┐        ┌───────────────────────┐      ┌──────────────────────┐
│ MongoDB ReplicaSet│        │ Upstash Redis (Free)  │      │ Payment Gateways     │
│ Multi-Doc ACID Tx │        │ 60s Dashboard Cache   │      │ SSLCommerz Sandbox   │
│ { tenantId } Scope│        │ Rate Limit Store      │      │ Stripe Test / bKash  │
└───────────────────┘        └───────────────────────┘      └──────────────────────┘
```

---

## 3. Feature List by Module

- **Auth & Session Security (`/api/v1/auth`):**
  - Atomic tenant + owner registration in a single MongoDB transaction.
  - 15-minute JWT access tokens stored **in memory only** (Zustand)—never in `localStorage` or `sessionStorage`.
  - 30-day opaque refresh tokens stored as SHA-256 hashes in `RefreshToken` with `httpOnly`, `SameSite=Lax` cookies, token rotation on every `/auth/refresh`, and **family reuse detection** (presenting an already-rotated token revokes the entire `familyId`).
- **Multi-Tenancy & RBAC (`/api/v1/tenants`, `/api/v1/users`):**
  - Every Mongoose query and aggregation pipeline filters by `tenantId` first. Cross-tenant header/query spoofing returns `403 TENANT_MISMATCH`.
  - Permission matrix enforced server-side (`owner`, `manager`, `staff`) + in-sidebar Demo RBAC Role Switcher.
- **Products & Stock Movement Ledger (`/api/v1/products`, `/api/v1/stock`):**
  - Compound unique `{ tenantId, sku }` index, low-stock threshold alerts, soft delete (`isActive=false`), append-only `StockMovement` audit trail, manual adjustments, and Pro CSV bulk import/export.
- **Atomic POS Counter Sales (`/api/v1/sales`):**
  - Runs inside a Mongoose replica-set transaction: decrements stock with `findOneAndUpdate({ _id, tenantId, stock: { $gte: qty } }, { $inc: { stock: -qty } }, { session })`. If any item lacks stock, the entire transaction aborts and returns `409 INSUFFICIENT_STOCK`.
  - Sequential per-shop invoice numbers (`INV-0001`…), printable receipt modal, and paid-sale return & restock flow.
- **Purchases, Suppliers & Baki Ledger (`/api/v1/purchases`, `/api/v1/suppliers`, `/api/v1/dues`):**
  - Receiving a purchase increments stock and updates supplier `totalDue` in one transaction.
  - Unified Baki ledger combining customer receivables and supplier payables across `0–7`, `8–30`, and `30+` day ageing buckets with partial/full payment recording.
- **Dashboard & Caching (`/api/v1/dashboard`):**
  - Tenant-scoped aggregation pipelines for revenue, net profit (`revenue − COGS`), average bill, top 5 products, and category breakdown. Cached for 60s (`X-Cache: HIT | MISS`) and invalidated on mutations.
- **Realtime, Jobs & Notifications (`/api/v1/notifications`, `/api/v1/admin/jobs`):**
  - Socket.io 4 server with JWT handshake verification and `tenant:<tenantId>` rooms (`sale:created`, `stock:low`, `notification:new`).
  - In-process BullMQ job scheduler (`low-stock-digest`, `due-reminders`, `subscription-expiry`, `weekly-report`) + Resend email digest helper + `SmsProvider` no-op seam.
- **Billing & Subscriptions (`/api/v1/billing`):**
  - Unified `BillingProvider` interface with **SSLCommerz Sandbox** (primary), **Stripe Test Mode** (secondary), and **bKash Tokenized Stub** (`501 NOT_CONFIGURED`).
  - Idempotent webhook/IPN processing via unique index `{ provider, eventId }` so replayed callbacks never double-extend the 30-day Pro period.

---

## 4. Hardest Decisions & Trade-Offs

1. **Why MongoDB Transactions Instead of Redis Distributed Locks for Stock:**
   Stock accuracy cannot depend on cache availability. By using a conditional `$gte` update inside a MongoDB replica-set transaction (`stock: { $gte: qty }`), MongoDB's WiredTiger document-level concurrency guarantees that two simultaneous sales of the last unit will never produce negative stock, even when Redis is offline.
2. **Why the BullMQ Worker Runs In-Process:**
   Render Free provides a single web service container without a free background worker dyno. Running the job scheduler in-process keeps the entire deployment 100% free while preserving clean queue/job boundaries.
3. **Why SSLCommerz Is Primary and Stripe Is Test-Only:**
   Bangladesh is not on Stripe's supported country list for live merchant payouts. SSLCommerz Sandbox models the authentic Bangladeshi BDT checkout + server-side validation API round-trip, while Stripe Test Mode demonstrates international webhook signature verification.
4. **Why Subscriptions Are 30-Day Prepaid Periods:**
   Local Bangladeshi payment rails (bKash, Nagad, local debit cards via SSLCommerz) do not support recurring card auto-debits. DokanOS models Pro (`৳499/mo`) as a `planExpiresAt` timestamp extended by 30 days per validated payment, with automated renewal reminders 3 days before expiry.

---

## 5. How to Run Locally

```bash
# 1. Enable pnpm via Corepack & install dependencies
corepack enable
pnpm install

# 2. Copy environment variables
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 3. Optional: start local MongoDB 7 replica set + Redis 7 via Docker
docker compose up -d mongo redis

# 4. Seed Rahim Pharmacy demo data (idempotent)
pnpm --filter api seed

# 5. Start the full-stack development server
pnpm dev
```

---

## 6. Test Story (Vitest + Supertest + MongoMemoryReplSet & Playwright)

Run the API integration & security test suite:
```bash
pnpm --filter api test
```
What is verified in `apps/api/tests/dokanos.test.ts`:
1. **Tenant Isolation:** Proves a user in Tenant A receives `0` rows and `404`/`403` when querying or spoofing Tenant B's products, sales, dues, or dashboard.
2. **Auth Rotation & Reuse Detection:** Verifies refresh token rotation invalidates the previous token and presenting a rotated token revokes the entire token family.
3. **RBAC Enforcement:** Verifies `staff` and `manager` are blocked (`403 FORBIDDEN`) from privileged endpoints.
4. **Parallel-Sale Concurrency:** Fires two concurrent POS sales for a product with `stock: 1`; asserts one returns `201`, one returns `409 INSUFFICIENT_STOCK`, and stock ends at `0`.
5. **Webhook Replay Idempotency:** Replays the same SSLCommerz IPN callback twice (`tran_id`) and asserts `planExpiresAt` extends by 30 days once, not 60.
6. **Aggregation & Cache-Aside Accuracy:** Verifies hand-computed revenue, COGS profit, top products, and `X-Cache: MISS` → `HIT`.
7. **Plan Limits:** Asserts creating the 101st product on the Free plan returns `403 PLAN_LIMIT`.
8. **Shared Zod Validation:** Asserts invalid sale payloads return `400 VALIDATION` with field details.

---

## 7. Honest Free-Tier Limits

- **Render Free Sleep:** The free backend sleeps after 15 minutes idle; first load can take 35–60 seconds to wake up (noted on the landing and login screens).
- **No Live Money:** SSLCommerz runs strictly in Sandbox mode (`4111111111111111`) and Stripe runs strictly in Test Mode (`4242424242424242`).
- **No Live SMS:** Because there is no permanent free SMS tier in Bangladesh, `SmsProvider` uses a documented no-op implementation while delivering in-app real-time notifications and Resend email digests.
