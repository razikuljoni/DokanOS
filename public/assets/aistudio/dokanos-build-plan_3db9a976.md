# DokanOS — Agent Build Guide

> **What this file is:** the complete, self-contained build specification for DokanOS. Any competent coding agent (Google AI Studio, Claude, Codex, etc.) can build the entire project by following this file phase by phase, without any other context.
>
> **How to use it:** paste this whole file into the agent, then give this command:
>
> `Build DokanOS following this guide, phase by phase. Start with Phase 0. After each phase, run that phase's acceptance checks and report the results before continuing to the next phase. Do not skip ahead. If a step is blocked, stop and report the blocker instead of inventing a workaround.`
>
> **Non-negotiable rules for the building agent:** everything must run on **free tiers only** — never create a paid account, never enter a payment method, never use a trial that converts to paid. Never put secrets in code. Never claim a feature works without running it. TypeScript strict mode everywhere. Every database query is scoped by `tenantId`. Small, incremental commits with clear messages.

---

## 0. Product overview

**DokanOS** is a multi-tenant inventory + sales SaaS for small Bangladeshi shops — a pharmacy, grocery, or electronics shop in Dhaka. One codebase serves many shops. Each shop is a **tenant** with its own products, stock, sales, suppliers, and staff.

**Users & roles**

| Role | What they do |
|---|---|
| Platform admin | Manages all tenants, sees platform health. No shop data access. |
| Shop owner | Full access to their shop: everything, including billing and staff. |
| Manager | Products, stock, sales, purchases, dues, dashboard. No billing, no staff management. |
| Staff | POS sales, product lookup, sales list. No purchases, no dues editing, no settings. |

**Core flows (the demo must show all of these)**

1. Owner signs up → a shop (tenant) is created → owner lands on the dashboard.
2. Owner adds products (or CSV import) → stock is tracked per product.
3. Staff opens the POS screen → searches a product → adds to cart → completes a cash sale → stock decrements atomically, sale appears on the dashboard instantly.
4. Owner records a purchase from a supplier → stock increases, supplier due is tracked in the "Baki" ledger.
5. Customer buys on credit → a due is recorded → owner records a partial payment later → due decreases.
6. Low-stock product → alert appears in the feed + email digest → owner reorders.
7. Owner upgrades to Pro → pays via SSLCommerz sandbox (test card) → plan unlocks Pro limits.

**What this project proves (the resume story):** Mongoose + aggregation pipelines, JWT access + rotating refresh tokens, RBAC, multi-tenancy, atomic stock transactions, Socket.io realtime, Redis caching, BullMQ jobs, Stripe + SSLCommerz payments with idempotent webhooks, Zod shared schemas, Vitest/Supertest tests, Docker, GitHub Actions CI/CD — all in one deployed product.

---

## 1. Tech stack (exact)

Use the latest stable version of each package as of October 2026. Do not downgrade to follow an old tutorial.

| Layer | Technology |
|---|---|
| Language | TypeScript 5.9, `strict: true` everywhere (no `any` without a comment justifying it) |
| Monorepo | pnpm workspaces |
| Frontend | React 19 + Vite 6, React Router 7, Tailwind CSS v4, shadcn/ui, TanStack Query v5, Zustand, React Hook Form + Zod, Recharts 3, Framer Motion 12, socket.io-client 4 |
| Backend | Node.js 20 LTS, Express 5, Mongoose 8, MongoDB Atlas (M0 free), Zod, jsonwebtoken, bcryptjs, cookie-parser, helmet, cors, express-rate-limit, socket.io 4, BullMQ 5, ioredis (Upstash), stripe SDK (test mode only), axios (for SSLCommerz API calls), resend (email) |
| Shared | `packages/shared`: Zod schemas + `z.infer` types, shared constants (roles, permissions, plan limits) |
| Testing | Vitest 3 + Supertest + mongodb-memory-server (API/integration); Playwright, Chromium only (3–5 smoke tests) |
| Tooling | ESLint + Prettier, GitHub Actions, Docker + docker-compose, dotenv |

**Free-tier hosts (only these):** frontend → Vercel Hobby; backend → Render free web service; database → MongoDB Atlas M0; cache/queue → Upstash Redis free; email → Resend free. Stripe is test mode only. SSLCommerz is sandbox only. bKash is a stub only (see §6).

---

## 2. Monorepo layout (pnpm workspaces)

```
dokanos/
├── package.json                 # workspaces: apps/*, packages/*
├── pnpm-workspace.yaml
├── turbo.json                   # optional; plain pnpm scripts are acceptable
├── docker-compose.yml
├── .github/workflows/ci.yml
├── .github/workflows/deploy.yml
├── apps/
│   ├── web/                     # React + Vite frontend
│   │   ├── src/
│   │   │   ├── routes/          # one file per route (see §5)
│   │   │   ├── components/      # AppShell, DataTable, StatCard, ChartCard, forms
│   │   │   ├── features/        # dashboard, pos, products, dues, billing (per-feature)
│   │   │   ├── lib/             # api client, socket client, query client, utils
│   │   │   ├── stores/          # zustand stores (auth, ui)
│   │   │   └── styles/          # tailwind + theme tokens
│   │   ├── .env.example
│   │   └── vite.config.ts
│   └── api/                     # Express backend
│       ├── src/
│       │   ├── config/          # env, db, redis, logger
│       │   ├── middleware/      # auth, rbac, tenant, error, rateLimit
│       │   ├── modules/         # one folder per module (see §4)
│       │   │   ├── auth/
│       │   │   ├── tenants/
│       │   │   ├── users/
│       │   │   ├── products/
│       │   │   ├── sales/
│       │   │   ├── purchases/
│       │   │   ├── suppliers/
│       │   │   ├── dues/
│       │   │   ├── dashboard/
│       │   │   ├── notifications/
│       │   │   ├── billing/
│       │   │   └── jobs/
│       │   ├── realtime/        # socket.io server
│       │   ├── queues/          # BullMQ queues + in-process worker
│       │   ├── utils/           # errors, pagination, validation
│       │   └── server.ts
│       ├── tests/               # vitest + supertest (see §9)
│       ├── scripts/seed.ts      # seed data + demo accounts
│       ├── Dockerfile
│       └── .env.example
└── packages/
    └── shared/                  # Zod schemas + inferred types + constants
        ├── src/schemas.ts
        ├── src/types.ts
        └── src/constants.ts
```

Rules: the frontend never imports from `apps/api`. Both apps import shared code only from `packages/shared`. No business logic in route handlers — thin controllers, logic in module services.

---

## 3. Data model (Mongoose)

Every collection except `RefreshToken` and platform-level records carries `tenantId`. **Every query must filter by `tenantId`.** There is no exception — a missing tenant filter is a bug, and the test suite must prove cross-tenant access is impossible (see §9).

### Tenant
| Field | Type / notes |
|---|---|
| `name` | string, required (e.g. "Rahim Pharmacy") |
| `slug` | string, unique, URL-safe (e.g. `rahim-pharmacy`) |
| `type` | enum: `pharmacy` \| `grocery` \| `electronics` \| `general` |
| `plan` | enum: `free` \| `pro`, default `free` |
| `planExpiresAt` | Date \| null (null = free forever) |
| `ownerId` | ObjectId → User |
| `settings.lowStockThreshold` | number, default 10 |
| `settings.currency` | string, default `BDT` |
| `createdAt`, `updatedAt` | timestamps |

Indexes: `slug` unique.

**Plan limits (enforce server-side, in `packages/shared/constants.ts`):** Free = 100 products, 1 staff member besides the owner, no CSV import, no dues reminders email. Pro = unlimited products, 5 staff, CSV import/export, email digests. Return HTTP 403 with error code `PLAN_LIMIT` when a limit is hit, and show an upgrade prompt in the UI.

### User
| Field | Type / notes |
|---|---|
| `name`, `email`, `passwordHash` | email unique **per tenant**: compound unique index `{ tenantId, email }` |
| `role` | enum: `platformAdmin` \| `owner` \| `manager` \| `staff` |
| `tenantId` | ObjectId → Tenant; `null` only for `platformAdmin` |
| `status` | enum: `active` \| `invited` \| `disabled` |
| `lastLoginAt` | Date \| null |

Passwords: bcryptjs, 12 rounds. Never return `passwordHash` in any API response.

### RefreshToken
| Field | Type / notes |
|---|---|
| `userId` | ObjectId → User |
| `tokenHash` | string — SHA-256 hash of the opaque token (never store the raw token) |
| `familyId` | string — all rotations of one login share a family |
| `expiresAt` | Date — 30 days |
| `revokedAt` | Date \| null |
| `userAgent`, `ip` | strings for the sessions list |

TTL index on `expiresAt` (auto-delete expired rows).

### Product
| Field | Type / notes |
|---|---|
| `tenantId`, `name`, `category`, `unit` | unit: `pcs` \| `box` \| `bottle` \| `strip` \| `kg` |
| `sku` | string — unique per tenant: compound unique index `{ tenantId, sku }` |
| `costPrice`, `sellPrice` | numbers in BDT (store as integer poisha? No — store as number, 2-decimal BDT; document the choice) |
| `stock` | number, default 0, min 0 — never negative |
| `lowStockAt` | number, default from tenant settings |
| `supplierId` | ObjectId → Supplier \| null |
| `isActive` | boolean |

Indexes: `{ tenantId, sku }` unique, `{ tenantId, category }`, text index on `name`.

### StockMovement
Append-only ledger. Every stock change writes one row: `tenantId`, `productId`, `type` (`sale` \| `purchase` \| `adjustment` \| `return`), `qtyChange` (negative for sales), `balanceAfter`, `refId` (sale/purchase id), `refType`, `userId`, `note`, `createdAt`. Index `{ tenantId, productId, createdAt }`.

### Sale
| Field | Type / notes |
|---|---|
| `tenantId`, `invoiceNo` | string — unique per tenant, sequential per shop (`INV-0001`…), compound unique `{ tenantId, invoiceNo }` |
| `items[]` | `{ productId, name, qty, price, lineTotal }` — snapshot the name/price at sale time |
| `subtotal`, `discount`, `total` | numbers (BDT) |
| `paymentMethod` | enum: `cash` \| `bkash` \| `card` \| `sslcommerz` |
| `paymentStatus` | enum: `paid` \| `partial` \| `due` |
| `paidAmount`, `dueAmount` | numbers |
| `customerName`, `customerPhone` | strings, optional |
| `soldBy` | ObjectId → User |
| `createdAt` | timestamps |

Indexes: `{ tenantId, createdAt }`, `{ tenantId, invoiceNo }` unique.

### Purchase
`tenantId`, `supplierId`, `items[]` (`{ productId, name, qty, costPrice, lineTotal }`), `total`, `paidAmount`, `dueAmount`, `status` (`received` \| `partial` \| `pending`), `receivedAt`, `createdBy`. Receiving a purchase increases stock and writes `StockMovement` rows.

### Supplier
`tenantId`, `name`, `phone`, `address`, `totalDue` (denormalised, recomputed from purchases/dues — keep it updated in the same transaction as any due change), `isActive`.

### Dues (no separate collection — derived, with one helper)
A due is a `Sale` with `dueAmount > 0` (customer owes the shop) or a `Purchase` with `dueAmount > 0` (shop owes the supplier). The dues ledger endpoint aggregates both. Recording a due payment creates a `DuePayment` row: `tenantId`, `partyType` (`customer` \| `supplier`), `partyName`, `partyPhone`, `refId` (sale/purchase id), `amount`, `method`, `receivedBy`, `createdAt` — and decrements the parent `dueAmount` in the same transaction. Ageing buckets: 0–7 days, 8–30 days, 30+ days (computed from the parent `createdAt`).

### Payment (billing)
`tenantId`, `provider` (`sslcommerz` \| `stripe` \| `bkash`), `providerRef` (tran_id / paymentID / Stripe session id), `eventId` (webhook event id, or `tran_id` for SSLCommerz), `amount`, `currency` (`BDT`), `status` (`pending` \| `paid` \| `failed` \| `refunded`), `purpose` (`subscription` \| `sale`), `raw` (the provider payload, for audit), `createdAt`. **Unique index `{ provider, eventId }`** — this is the idempotency mechanism (see §6).

### Subscription
`tenantId`, `provider`, `plan` (`free` \| `pro`), `status` (`active` \| `past_due` \| `cancelled` \| `expired`), `currentPeriodEnd`, `providerSubscriptionId` (Stripe only, null for SSLCommerz). Local gateways have no auto-renewal: a Pro subscription is a 30-day period set by `planExpiresAt` on the Tenant, extended by each successful payment.

### Notification
`tenantId`, `userId` (null = all shop users), `type` (`low_stock` \| `due_reminder` \| `payment` \| `subscription`), `title`, `body`, `link` (in-app route), `isRead`, `createdAt`. Index `{ tenantId, userId, createdAt }`.

### AuditLog (Phase 2)
`tenantId`, `userId`, `action` (e.g. `sale.created`, `product.deleted`, `plan.upgraded`), `entity`, `entityId`, `changes` (JSON), `createdAt`.

---

## 4. Auth, RBAC, multi-tenancy

### Auth flow (exact)
- **Access token:** JWT, 15-minute expiry, sent as `Authorization: Bearer <token>`. The frontend keeps it **in memory only** (Zustand store) — never in `localStorage` or `sessionStorage`.
- **Refresh token:** opaque random string (64 bytes), stored **hashed with SHA-256** in the `RefreshToken` collection, delivered as an `httpOnly`, `Secure`, `SameSite=Lax` cookie, 30-day expiry. The raw token is never stored server-side and never sent to the frontend in a body.
- **Rotation:** every `POST /auth/refresh` issues a new refresh token (same `familyId`), invalidates the old one, and returns a new access token. **Reuse detection:** if an already-rotated (or revoked) refresh token is presented again, revoke the entire family immediately and force a full re-login — this is a theft signal.
- **Endpoints:** `POST /auth/register` (creates Tenant + owner User in one transaction), `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` (revokes the current refresh token), `GET /auth/me`.
- **Sessions:** `GET /auth/sessions` lists active refresh families (device, IP, last used); `DELETE /auth/sessions/:familyId` revokes one.

### RBAC (permission middleware)
Define a permission map in `packages/shared/constants.ts`, e.g. `products:write` → owner, manager; `billing:write` → owner only; `staff:write` → owner only; `purchases:write` → owner, manager; `sales:write` → owner, manager, staff. Middleware `requirePermission('products:write')` runs after auth and returns 403 otherwise. The frontend mirrors this: hide/disable actions the role cannot do — but **never rely on UI hiding alone**; the server is the enforcement point.

### Tenant scoping
Auth middleware attaches `req.user` (id, role, tenantId). Tenant middleware resolves the tenant and attaches `req.tenant`. Every service function takes `tenantId` as its first argument and includes it in every query. A `GET /api/...` without a tenant filter must fail code review — the test suite enforces it (§9).

### Rate limiting & security
- `helmet()`, strict CORS (allow only the deployed frontend origin + `http://localhost:5173` in dev).
- Global rate limit: 300 requests / 15 min per IP; auth routes: 10 attempts / 15 min per IP; billing init: 20 / hour per user.
- Central error handler: every error returns `{ error: { code, message } }` with a stable `code` (e.g. `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `PLAN_LIMIT`, `INSUFFICIENT_STOCK`, `TENANT_MISMATCH`). Never leak stack traces to the client.

---

## 5. API endpoints

Base: `/api/v1`. All endpoints require auth unless marked public. All responses are JSON. List endpoints use `?page&limit&search&sort&filter` with server-side pagination (`{ data, meta: { page, limit, total, totalPages } }`).

### Auth — `/auth`
| Method & path | Role | Notes |
|---|---|---|
| `POST /auth/register` | public | Body: shop name, shop type, owner name/email/password. Creates tenant + owner in one transaction. |
| `POST /auth/login` | public | Returns access token (body) + refresh cookie. |
| `POST /auth/refresh` | cookie | Rotates refresh token; reuse → revoke family. |
| `POST /auth/logout` | auth | Revokes current refresh token, clears cookie. |
| `GET /auth/me` | auth | Current user + tenant + plan. |
| `GET /auth/sessions` | auth | Active sessions. |
| `DELETE /auth/sessions/:familyId` | auth | Revoke one session. |

### Tenants & settings — `/tenants`
`GET /tenants/me` (owner/manager), `PATCH /tenants/me` (owner: name, type, low-stock threshold), `GET /tenants/me/usage` (owner: product count, staff count vs plan limits).

### Users / staff — `/users`
`GET /users` (owner/manager), `POST /users/invite` (owner: creates staff with a one-time setup link — no email sending in Phase 1, show the link in UI), `PATCH /users/:id/role` (owner), `PATCH /users/:id/status` (owner: disable), `DELETE /users/:id` (owner, cannot delete self or the owner).

### Products — `/products`
`GET /products` (search, category filter, stock-status filter, sort, paginate), `GET /products/:id`, `POST /products` (owner/manager; Zod-validated; SKU unique per tenant), `PATCH /products/:id`, `DELETE /products/:id` (owner/manager; soft-delete via `isActive=false`), `POST /products/import` (Pro only; CSV upload, row-by-row validation report), `GET /products/export` (Pro only; CSV download), `GET /products/low-stock` (products at or below `lowStockAt`).

### Stock — `/stock`
`GET /stock/movements?productId&from&to` (paginated ledger), `POST /stock/adjust` (owner/manager: manual correction with a required note; writes a `StockMovement`).

### Sales (POS) — `/sales`
`POST /sales` (owner/manager/staff) — **the critical endpoint.** Runs in a Mongoose transaction: for each item, atomically decrement stock with `findOneAndUpdate({ _id, tenantId, stock: { $gte: qty } }, { $inc: { stock: -qty } }, { session })` — if any item fails (insufficient stock), abort the whole transaction and return `INSUFFICIENT_STOCK` naming the product. Then create the Sale + `StockMovement` rows, generate the next `invoiceNo`, emit a Socket.io `sale:created` event to the tenant room, and invalidate the dashboard cache. `GET /sales` (filters: date range, payment status, soldBy), `GET /sales/:id`, `POST /sales/:id/return` (owner/manager: restock + create a return movement; only for paid sales).

### Purchases — `/purchases`
`GET /purchases`, `POST /purchases` (owner/manager: creates purchase + increases stock + writes movements, all in one transaction), `GET /purchases/:id`, `PATCH /purchases/:id/pay` (record a payment against the due).

### Suppliers — `/suppliers`
`GET /suppliers`, `POST /suppliers`, `PATCH /suppliers/:id`, `GET /suppliers/:id/dues` (their outstanding purchases).

### Dues ("Baki" ledger) — `/dues`
`GET /dues` (unified list: customer dues from sales + supplier dues from purchases; filters by party type, ageing bucket, search), `GET /dues/summary` (totals: receivable, payable, ageing buckets 0–7 / 8–30 / 30+ days), `POST /dues/:refId/payments` (record a payment: creates `DuePayment`, decrements the parent `dueAmount` in the same transaction, updates the supplier `totalDue`).

### Dashboard (aggregation) — `/dashboard`
`GET /dashboard/summary?from&to` — one aggregation pipeline per metric, all scoped by `tenantId` with `$match` first: revenue in range, profit (revenue − cost of goods sold), sales count, average bill, top 5 products by revenue, sales by category, low-stock count, dues outstanding (receivable + payable). Response is cached in Redis for 60s (see §8) and invalidated on any sale/purchase/product change. `GET /dashboard/sales-trend?from&to&granularity=daily` — daily revenue series for the chart.

### Notifications — `/notifications`
`GET /notifications` (paginated, newest first), `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `GET /notifications/unread-count`.

### Billing — `/billing`
`GET /billing/plan` (current plan, limits, usage, `planExpiresAt`), `POST /billing/sslcommerz/init` (owner: creates a `Payment` row `pending`, calls SSLCommerz, returns `GatewayPageURL`), `POST /billing/sslcommerz/success` | `/fail` | `/cancel` (public callbacks from the gateway — validate, then redirect to the frontend result page), `POST /billing/sslcommerz/ipn` (public: re-validate via the SSLCommerz validation API — never trust the IPN body alone), `POST /billing/stripe/checkout` (owner: creates a Stripe Checkout Session, test mode), `POST /billing/stripe/webhook` (public: signature-verified, idempotent), `POST /billing/cancel` (owner: cancel Pro at period end).

---

## 6. Frontend

### Design reference
Google Stitch designs are being produced for this project (premium, clean, "modern ledger" style). Use them as the visual reference when they are available. **If the Stitch links are not yet attached to this file, build from the design system below — it is complete on its own and matches the Stitch brief.**

### Design system (do not deviate)
- **Style:** "modern ledger" — warm paper background `#FAF7F2`, ink text `#1C1917`, deep green primary `#14532D`, amber warning `#B45309`, red danger `#B91C1C`, hairline borders `#E7E0D4`, 8px radius, subtle shadows only.
- **Strictly forbidden (AI slop):** purple/blue gradients, glassmorphism, generic blue SaaS look, emoji icons, lorem ipsum, empty charts. Every screen shows realistic seeded data.
- **Typography:** Space Grotesk for headings and display numbers; Inter for body/UI; `tabular-nums` for all money and stock figures. Currency: `৳` (BDT). Dates: Asia/Dhaka.
- **Layout:** desktop-first. Dark ink sidebar (`#1C1917`, white text) with shop switcher at the top; top bar with global search, notification bell (unread badge), and user menu. Dense, professional tables. Loading skeletons for every data view; friendly empty states ("No low-stock items — nice.") — never a blank page.
- **Motion (Framer Motion):** route fade/slide (150–200ms), sidebar collapse, POS cart line-item add animation, toast slide-in, modal scale/fade. Motion is for feedback, never decoration for its own sake. Respect `prefers-reduced-motion`.
- **Dark mode:** Phase 3. Design tokens must be CSS variables so dark mode is a token swap, not a rewrite.

### Routes
| Route | Screen | Roles |
|---|---|---|
| `/` | Landing page (hero, features, pricing Free/Pro ৳499/mo, footer) | public |
| `/login`, `/register` | Auth screens, split layout, "Try the demo shop" one-click demo login | public |
| `/app/dashboard` | Stat cards, revenue chart, top products, low-stock list, recent sales | all |
| `/app/sales/new` | POS: product search + cart + payment method + big total + complete sale | all |
| `/app/sales` | Sales list (filters, pagination), sale detail drawer with invoice view + print | all |
| `/app/products` | Products table (search, category/stock filters, sort, paginate), add/edit drawer, CSV import/export (Pro) | owner, manager (staff: read-only) |
| `/app/products/:id` | Product detail: stock movements ledger, sales history | owner, manager |
| `/app/purchases` | Purchase orders + "New purchase" form | owner, manager |
| `/app/suppliers` | Supplier list with total due, supplier detail + due history | owner, manager |
| `/app/dues` | Baki ledger: receivable + payable, ageing buckets, record-payment flow | owner, manager |
| `/app/alerts` | Notification feed (low stock, dues, payments), read/unread | all |
| `/app/billing` | Plan card, usage meters, upgrade (SSLCommerz/Stripe test), invoice history | owner |
| `/app/staff` | Staff list, invite form, role editor, permission matrix | owner |
| `/app/settings` | Shop profile, low-stock threshold, currency, sessions list | owner |

### Components (build once, reuse everywhere)
`AppShell` (sidebar + topbar), `DataTable` (server-side pagination, sorting, filters, bulk actions, CSV export button), `StatCard`, `ChartCard` (Recharts wrappers: line, bar, donut), `SaleForm` (multi-step POS), `ProductForm`, `DuePaymentDialog`, `LowStockBanner`, `NotificationBell`, `PlanBadge` (Free/Pro), `EmptyState`, `Skeleton`, `ConfirmDialog`, `Toast`.

### State & data
- **Server state:** TanStack Query everywhere. Query keys namespaced by tenant (`['products', tenantId, filters]`). Invalidate `dashboard` + `products` + `dues` after any sale/purchase/payment mutation. Optimistic updates for POS cart and Kanban-style lists only where rollback is implemented.
- **Client state:** Zustand for auth (in-memory access token), UI (sidebar, toasts). No Redux.
- **Forms:** React Hook Form + Zod, using the shared schemas from `packages/shared` — the same schema validates on client and server.
- **Realtime:** a `useSocket` hook — connects on login with the access token, joins the tenant room, listens for `sale:created`, `stock:low`, `notification:new`; updates the TanStack cache (no full refetch), shows a toast. Reconnect with backoff; on reconnect, refetch the dashboard.
- **Charts:** Recharts 3 — revenue line (daily), top-products bar, category donut, dues ageing bar. All fed by the aggregation endpoints. Never hardcode chart data.

---

## 7. Payments

All billing goes through a single `BillingProvider` interface in the API (`createCheckout(tenant, plan)`, `handleWebhook(req)`, `getSubscription(id)`). The frontend never talks to a gateway directly.

### SSLCommerz — PRIMARY (sandbox, fully implemented)
- **Setup:** sandbox account at `https://developer.sslcommerz.com` (self-serve sandbox). Sandbox gateway: `https://sandbox.sslcommerz.com`. Docs: `https://developer.sslcommerz.com/docs.html`.
- **Env:** `SSLCZ_STORE_ID`, `SSLCZ_STORE_PASSWD`, `SSLCZ_SANDBOX=true`, `SSLCZ_SUCCESS_URL`, `SSLCZ_FAIL_URL`, `SSLCZ_CANCEL_URL`, `SSLCZ_IPN_URL` (all pointing at the deployed Render URL in production).
- **Flow (exact):**
  1. `POST /billing/sslcommerz/init` (owner) → create a `Payment` row (`status: pending`, unique `tran_id`, e.g. `DKN-<tenantSlug>-<timestamp>`), then `POST https://sandbox.sslcommerz.com/gwprocess/v4/api.php` with `store_id`, `store_passwd`, `total_amount` (BDT, between 10 and 500,000), `currency: BDT`, `tran_id`, `success_url`, `fail_url`, `cancel_url`, `ipn_url`, `cus_name`, `cus_email`, `cus_phone`, `product_name: "DokanOS Pro (30 days)"`, `product_category: "Subscription"`.
  2. Return `GatewayPageURL` → frontend redirects the owner there.
  3. Gateway redirects back to `success/fail/cancel` → **do not trust the redirect alone.** Server validates with `GET https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?val_id=<val_id>&store_id=...&store_passwd=...&v=1&format=json`.
  4. Accept only if `status` is `VALID` or `VALIDATED` **and** `tran_id`, `amount`, and `currency` match the stored `Payment` row. Then, in one transaction: mark the Payment `paid`, set Tenant `plan=pro` and `planExpiresAt = now + 30 days`, create the Subscription row, emit a notification.
  5. **IPN:** SSLCommerz IPN has **no HMAC signature** — the validation-API round-trip above is the only trust anchor. Always re-validate on IPN.
  6. **Idempotency:** the unique index `{ provider: 'sslcommerz', eventId: tran_id }` guarantees a replayed callback cannot double-extend the plan. Handle duplicate-key errors as "already processed", not as failures.
- **Test values (official sandbox docs):** Visa `4111111111111111`, Mastercard `5111111111111111`, Amex `371111111111111`, expiry `12/26`, CVV `111`, OTP `111111` or `123456`.
- **Honest limits (write these in the README):** sandbox only; live SSLCommerz needs a registered business, bank account, and documents. No auto-renewal — Pro is a 30-day period per payment; renewal is a new one-off payment, with a reminder 3 days before expiry.

### Stripe — SECONDARY (test mode only, behind the same interface)
- Checkout Sessions for the Pro plan; webhook endpoint verifies the signature with the endpoint secret (`stripe.webhooks.constructEvent`); handle `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`; idempotent on the Stripe event id.
- Test card: `4242 4242 4242 4242`; decline: `4000000000000002`; 3DS: `4000002500003155`. Label every Stripe surface **"TEST MODE"** in the UI.
- **Honest limits:** Bangladesh is not on Stripe's supported-country list — live Stripe payouts to a Bangladeshi business are impossible. Stripe here proves international billing skill, not a live option. Whether a developer in Bangladesh can even create a Stripe test account is unverified — do not falsify jurisdiction or country during signup; if signup blocks Bangladesh, document it in the README and keep SSLCommerz as the only live demo path.

### bKash — STUB ONLY
Implement the `BillingProvider` stub (`createCheckout` returns `501 NOT_CONFIGURED` with a clear message) and document the tokenized flow in code comments (grant-token → create → redirect → execute → query). Do **not** wire a live or sandbox bKash flow: sandbox access requires Merchant Integration Portal signup and validation, and live needs a trade license, TIN, bank account, and IP whitelisting. The stub proves the architecture is provider-agnostic without faking a payment.

### Subscription model
Pro = **৳499 / month** (demo price — a single constant in `packages/shared/constants.ts`, easy to change). Free limits are enforced server-side (§3). The billing page shows the current plan, usage vs limits, `planExpiresAt`, and a 3-day-before-expiry reminder (job + notification).

---

## 8. Realtime, caching, jobs, notifications

### Socket.io (realtime)
- Server: Socket.io 4 attached to the Express HTTP server. Auth on handshake — the client sends the access token; reject the handshake without a valid token. Each connection joins room `tenant:<tenantId>`.
- Events (server → client): `sale:created` (new sale summary), `stock:low` (product, current stock), `stock:updated` (product, new stock), `notification:new` (full notification object).
- The server emits only to the affected tenant's room — never broadcast globally. On reconnect, the client refetches the dashboard query.
- Single Render instance is fine for the demo (no multi-instance pub/sub needed at this scale). Document that horizontal scaling would need the Redis adapter — do not implement it.

### Redis / Upstash (caching + rate limiting)
- Client: `ioredis` pointed at Upstash (free tier). If Upstash is unreachable in local dev, the app must still boot — cache calls degrade to "miss" and rate limiting degrades to in-memory (log a warning; never crash).
- **Cache-aside:** `GET /dashboard/summary` and `/dashboard/sales-trend` are cached for 60s under keys `dash:summary:<tenantId>:<from>:<to>`. Invalidate on any sale, purchase, product, or due-payment mutation for that tenant.
- **Rate limiting:** express-rate-limit with a Redis store for the API (see §4 limits).
- **No Redis pub/sub, no distributed locks** in this project — stock safety comes from the MongoDB transaction (§5), not from Redis.

### BullMQ (background jobs — in-process worker)
On Render free there is **no second service** — the worker runs in-process with the API server (document this as a deliberate free-tier trade-off in the README). Queues:
| Job | Schedule / trigger | What it does |
|---|---|---|
| `low-stock-digest` | Daily 09:00 Asia/Dhaka | Finds products at/below threshold per tenant → creates notifications + sends one Resend email per owner (Pro only for email; Free gets in-app only). |
| `due-reminders` | Daily 08:00 Asia/Dhaka | Dues aged 7+ days → notification to the owner; dues 30+ days → escalated wording. |
| `subscription-expiry` | Daily 09:00 Asia/Dhaka | Pro expiring in 3 days → notification + email with a renew link. |
| `weekly-report` | Mondays 09:00 (Pro) | Revenue/top-products summary email. |

Jobs are retried with exponential backoff (3 attempts). Job failures are logged, never crash the server. A simple `/admin/jobs` status view (owner) shows last run + next run per job — no full job dashboard needed.

### Notifications
- **In-app (Phase 1):** the `Notification` collection + Socket.io push + the `/app/alerts` feed. Every low-stock event, due reminder, payment success, and plan change creates one.
- **Email (Phase 2, Resend free — 3,000/month, 100/day):** digests and reminders only. Sender: `DokanOS <noreply@dokan-os.dev>` (or the Resend sandbox sender until a domain is verified — document it).
- **SMS:** build a `SmsProvider` interface with a no-op implementation. **Do not wire a live SMS provider** — there is no usable free tier (Twilio trial is 100 messages / 30 days only; Bangladeshi bulk SMS is ~৳0.30/SMS). The seam proves the design; shipping in-app + email only is the honest scope.

---

## 9. Testing

Framework: Vitest 3 + Supertest + mongodb-memory-server. Test files live in `apps/api/tests/`. Run with `pnpm --filter api test`. CI runs the suite on every PR (see §10).

**Write these tests first (priority order — a handful of tests on the hard paths beats 80% coverage of trivial getters):**
1. **Tenant isolation:** user from tenant A requests tenant B's products/sales/dashboard → expect 403 or 404, and zero rows leaked. Test this for products, sales, dues, and dashboard.
2. **Auth:** login returns access token + sets the refresh cookie; refresh rotates (old token stops working); presenting a rotated refresh token revokes the whole family (reuse detection); logout revokes.
3. **RBAC:** staff calling `POST /products`, `GET /billing/plan`, or `POST /users/invite` → 403. Manager calling billing → 403.
4. **Parallel-sale concurrency:** seed one product with stock 1; fire two sale requests concurrently; exactly one succeeds, stock ends at 0 (never negative), the other returns `INSUFFICIENT_STOCK`.
5. **Webhook replay:** send the same SSLCommerz validation callback twice (same `tran_id`) → one `Payment` marked paid, plan extended exactly once (30 days, not 60).
6. **Aggregation correctness:** seed known sales, then assert the dashboard summary revenue/profit/top-products match hand-computed values.
7. **Plan limits:** free tenant creating the 101st product → 403 `PLAN_LIMIT`.
8. **Zod validation:** invalid sale body (negative qty, missing product) → 400 `VALIDATION` with field errors.

**Playwright (Chromium only, separate workflow):** 3 smoke tests — (a) demo login lands on the dashboard with data, (b) complete a POS sale end-to-end, (c) dashboard charts render. Keep it to these three.

**Rule:** no phase is "done" until its tests pass in CI. Do not lower the bar by deleting a failing test — fix the code or report the blocker.

---

## 10. Docker & CI/CD

### Docker (local dev + API image)
- `apps/api/Dockerfile`: multi-stage, `node:20-alpine`; install pnpm, copy workspace files, `pnpm install --frozen-lockfile`, build, run as non-root, `CMD ["node", "dist/server.js"]`. Health endpoint `GET /health` returns `{ ok: true }`.
- `docker-compose.yml` (local dev only — never used in production): services `api` (build from `apps/api`, port 4000, env from `.env`), `web` (Vite dev server, port 5173), `mongo` (`mongo:7`, named volume, port 27017), `redis` (`redis:7-alpine`, port 6379). Healthchecks on mongo and redis; api depends on them being healthy.
- The web app is **not** Dockerised for production — it deploys to Vercel.

### GitHub Actions
- `.github/workflows/ci.yml` — on every PR and push to `main`: install (pnpm, frozen lockfile) → lint → typecheck (both apps + shared) → `pnpm --filter api test` (Vitest/Supertest) → build both apps. All steps must pass; no merging on red.
- `.github/workflows/e2e.yml` — on push to `main` only: Playwright Chromium smoke tests against the preview deployment.
- `.github/workflows/deploy.yml` — on push to `main`: deploy web to Vercel (Vercel Git integration is acceptable — document which one is used) and trigger the Render deploy hook for the API. After deploy, run a smoke check: `GET <render-url>/health` returns ok, and the frontend loads.

---

## 11. Deployment (free tiers only)

| Piece | Host | Notes |
|---|---|---|
| Frontend | Vercel Hobby | Non-commercial use only. Connect the GitHub repo; root directory `apps/web`; build `pnpm build`; output `dist`. |
| Backend | Render free web service | Root directory `apps/api`; build `pnpm install && pnpm build`; start `node dist/server.js`. **Sleeps after 15 min idle; first load takes ~35–60s.** Put a visible note on the landing page and the login screen: "First load may take up to a minute — the free server wakes up." Do not use uptime-pinger hacks to keep it awake. |
| Database | MongoDB Atlas M0 | 512 MB, ~100 ops/sec, pauses after 30 days with no connections. It **is** a 3-node replica set, so multi-document transactions work. Keep seed data small and indexed. |
| Cache/queue | Upstash Redis free | 256 MB / 500k commands per month (verify the current quota on Upstash's pricing page at build time — sources disagree). |
| Email | Resend free | 3,000 emails/month, 100/day. |
| Payments | SSLCommerz sandbox + Stripe test mode | No real money anywhere. |

### Environment variables
**API (`apps/api/.env`, never committed — provide `.env.example`):**

| Variable | Example / notes |
|---|---|
| `PORT` | `4000` |
| `NODE_ENV` | `development` \| `production` |
| `MONGODB_URI` | Atlas connection string |
| `JWT_ACCESS_SECRET` | random 64-char string (generate, never reuse across environments) |
| `REFRESH_TOKEN_SECRET` | random 64-char string (used only to sign the cookie? No — refresh tokens are opaque + hashed; this secret is for the cookie signature. Document it.) |
| `COOKIE_SECRET` | random 64-char string |
| `FRONTEND_URL` | `http://localhost:5173` (dev) / Vercel URL (prod) — the only allowed CORS origin |
| `UPSTASH_REDIS_URL` | Upstash `rediss://` URL (optional in dev) |
| `RESEND_API_KEY` | Resend key (optional until Phase 2 email) |
| `SSLCZ_STORE_ID`, `SSLCZ_STORE_PASSWD` | SSLCommerz sandbox credentials |
| `SSLCZ_SANDBOX` | `true` |
| `SSLCZ_SUCCESS_URL`, `SSLCZ_FAIL_URL`, `SSLCZ_CANCEL_URL`, `SSLCZ_IPN_URL` | `${API_URL}/api/v1/billing/sslcommerz/...` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe **test** keys (`sk_test_…`, `whsec_…`) |
| `SEED_DEMO` | `true` to run the seed script on first boot (dev only) |

**Web (`apps/web/.env`):** `VITE_API_URL` (Render URL in prod, `http://localhost:4000` in dev), `VITE_SOCKET_URL` (same as API URL), `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`, only if Stripe checkout is wired in Phase 2).

### Seed data & demo login (required — no screen may ever be empty)
`pnpm --filter api seed` creates:
- Tenant **"Rahim Pharmacy"** (Mirpur, Dhaka), type `pharmacy`, plan `pro` (so the demo shows Pro features), owner `demo@dokan-os.demo` / `Demo1234!`, manager `manager@dokan-os.demo` / `Demo1234!`, staff `staff@dokan-os.demo` / `Demo1234!`.
- 40 realistic products (Napa Extra, Seclo 20, ORS Saline, Azithral 500, Glucometer strips, etc.) across categories (Medicine, Surgical, Baby Care, Daily Needs), with cost/sell prices in ৳ and mixed stock levels (5 deliberately low-stock).
- 3 suppliers (Square Pharmaceuticals distributor, ACI Healthcare, local wholesaler) with dues.
- 120 sales spread over the last 30 days (so charts have shape), 8 purchases, 6 open customer dues + 4 supplier dues, 3 unread notifications.
- The landing page and login screen have a **"Try the demo shop"** button that logs in as the demo owner in one click. The demo tenant resets nightly is *not* required — but the seed script must be idempotent (safe to re-run).

---

## 12. Phased build plan

Work in order. Do not start a phase until the previous phase's acceptance checks pass. Report the phase result before continuing.

### Phase 0 — Scaffold (foundation)
**Build:** initialise the pnpm monorepo (apps/web, apps/api, packages/shared); TypeScript strict configs; ESLint + Prettier; Tailwind v4 + shadcn/ui in web; Express 5 skeleton in api with helmet/CORS/JSON parsing/central error handler; `GET /health`; docker-compose for local mongo + redis; GitHub Actions `ci.yml`; `.env.example` files in both apps; README skeleton.
**Acceptance:** `pnpm install` is clean; `pnpm lint` + `pnpm typecheck` pass; both apps boot locally; `GET /health` returns `{ ok: true }`; docker-compose brings up mongo + redis healthy; CI is green on the first PR.

### Phase 1 — Core (the resume project, must-have)
**Build, in this order:**
1. Shared Zod schemas + types (auth, product, sale, purchase, due, billing).
2. Auth: register (tenant + owner in one transaction), login, refresh rotation + reuse detection, logout, sessions list. RBAC middleware + permission map. Tenant middleware.
3. Products: CRUD, SKU uniqueness, search/filter/sort/pagination, low-stock list, soft delete.
4. POS sale: the atomic transaction (§5), invoice numbers, stock movements, sale list + detail.
5. Purchases + suppliers: receive purchase → stock up; supplier dues.
6. Dues ledger: unified receivable/payable list, ageing buckets, record-payment flow.
7. Dashboard: aggregation pipelines (revenue, profit, top products, sales by category, dues), sales-trend endpoint; Recharts dashboard UI.
8. SSLCommerz sandbox billing: init → redirect → validation → plan upgrade, idempotent; plan limits enforced; billing page.
9. Seed script + demo login + landing page + auth screens.
10. Tests from §9 (items 1–8) + deploy both tiers + README v1 (see §13).
**Acceptance:** demo login works on the deployed links; a full POS sale decrements stock and appears on the dashboard; a concurrent double-sale of the last item leaves stock at 0 with exactly one success; an SSLCommerz sandbox payment (test card `4111111111111111`) upgrades the tenant to Pro; all §9 tests pass in CI; no screen is empty without seed data.

### Phase 2 — Realtime, scale, polish (depth)
**Build, in this order:**
1. Socket.io: auth on handshake, tenant rooms, `sale:created` / `stock:low` / `notification:new`; frontend `useSocket` hook with cache updates + toasts.
2. Redis: dashboard cache-aside (60s) + invalidation on mutations; Redis-backed rate limiting.
3. BullMQ in-process worker: low-stock digest, due reminders, subscription-expiry reminders; job status view.
4. Resend email: digests + reminders (Pro only for email).
5. Stripe test-mode provider behind `BillingProvider` (Checkout + signature-verified webhook).
6. Staff management UI (invite, roles, disable) + audit log.
7. CSV import/export (Pro), notifications feed UI.
**Acceptance:** open two browser windows (owner + staff) — a POS sale in one updates the dashboard and fires a low-stock toast in the other without refresh; dashboard responses are served from cache (check the `X-Cache` header you add) and invalidate after a sale; a Stripe test payment (`4242 4242 4242 4242`) completes end-to-end; a replayed webhook does not double-charge or double-extend.

### Phase 3 — Ship (presentation)
**Build:** Framer Motion pass (route transitions, POS animations, toasts, modals); dark mode via CSS-variable token swap; landing page polish; Playwright smoke tests (3); README case study + architecture diagram + GIF of the key flow (POS sale → dashboard update → low-stock alert); final deploy verification on both tiers; resume links (live frontend, live API, GitHub repo).
**Acceptance:** the 3 Playwright smoke tests pass against the deployed preview; the README answers — problem, architecture, hardest decisions, trade-offs, how to run it, demo login — without the reader opening the code; first paint of the dashboard is under ~3 seconds once the Render instance is warm.

### Cut list (do not build these)
Live SMS, live payments on any gateway, multi-branch shops, Bangla UI translation, MFA, a mobile app, Redis pub/sub horizontal scaling, a separate worker service. If the user asks for any of these later, they are a new phase — not a silent addition.

---

## 13. README requirements (the resume case study)

The repo README is part of the product. It must contain: (1) one-line pitch + live demo links (frontend, API health) + demo login credentials; (2) the problem and who it is for; (3) an architecture diagram (monorepo, request flow, where each technology lives); (4) the feature list grouped by module; (5) the hardest decisions and trade-offs (why transactions not Redis locks for stock; why the BullMQ worker is in-process on free tier; why SSLCommerz is primary and Stripe is test-only; why subscriptions are repeated one-off payments); (6) how to run locally (prereqs, env, seed, `pnpm dev`); (7) the test story (what is tested and why); (8) a GIF of the core flow; (9) honest limits (Render sleep, no live payments, no SMS). No dead links — every link in the README must be clicked and verified before the repo is called done.

## 14. Rules for the building agent (read before writing any code)
1. Free tiers only. If a step needs a paid account, stop and report it.
2. Never invent a feature, endpoint, or library not in this guide. If something is missing from the guide, ask the user instead of guessing.
3. TypeScript strict; no `any` without a justifying comment; no `console.log` of secrets or tokens.
4. Every query is tenant-scoped. Every mutation that touches stock or money runs in a transaction.
5. Do not use `localStorage` for tokens. Do not store raw refresh tokens. Do not trust gateway redirects or IPN bodies without server-side validation.
6. Commit in small steps with messages like `feat(sales): atomic POS sale with stock transaction`. Never one giant "initial commit" with the whole project.
7. After each phase, run the acceptance checks and report pass/fail honestly. A failing check is a blocker, not a reason to delete the test.
8. If the Stitch frontend designs are attached to this guide (see §6), follow their screens and tokens. If they are not attached, follow the design system in §6 exactly.

## Appendix — frontend design reference
- Google Stitch designs for DokanOS (all 10 screens, "modern ledger" system, each its own Stitch project; every project's export panel offers Figma, Code to Clipboard, .zip, and AI Studio):
  - Dashboard: [DokanOS Pharmacy Ledger Dashboard](https://stitch.withgoogle.com/projects/1595863755197281926)
  - POS new sale: [DokanOS Pharmacy POS Terminal](https://stitch.withgoogle.com/projects/710683155229567515)
  - Products & stock: [DokanOS Pharmacy Stock Ledger](https://stitch.withgoogle.com/projects/17538290120668458932)
  - Baki dues ledger: [DokanOS Baki Dues Ledger](https://stitch.withgoogle.com/projects/5579261897130636171)
  - Landing page: [DokanOS Shop Ledger Landing Page](https://stitch.withgoogle.com/projects/205076478742465068)
  - Login + signup: [DokanOS Authentication Portal](https://stitch.withgoogle.com/projects/17655165030758922452)
  - Purchases & suppliers: [DokanOS Purchases & Suppliers Ledger](https://stitch.withgoogle.com/projects/1632184703096631366)
  - Billing & subscription: [DokanOS Billing Portal](https://stitch.withgoogle.com/projects/8733952611025925716)
  - Alerts & notifications: [DokanOS Alerts & Notifications Hub](https://stitch.withgoogle.com/projects/201587665913992185)
  - Settings & staff: [DokanOS Shop Settings Manager](https://stitch.withgoogle.com/projects/2263200710302222977)
- Notes on the designs: no sign-in was needed and nothing was paid. Two label differences from the spec: the POS primary button reads "Settle & Print Receipt" (not "Complete sale"), and the billing screen shows the annual-switch/Manage Plan control because its seeded account is already on Pro (no Free-to-Pro button in that shot). The dashboard design shows the date "Friday, 24 May 2024" instead of 29 Oct 2026 — cosmetic only. No separate Figma file was created (that needs a Figma account connected); code export is clipboard-based and was verified on the dashboard design.
- Design tokens: paper `#FAF7F2`, ink `#1C1917`, primary green `#14532D`, amber `#B45309`, danger `#B91C1C`, borders `#E7E0D4`, radius `8px`; Space Grotesk (display) + Inter (UI); currency `৳`; timezone `Asia/Dhaka`.

---
*DokanOS build guide v1 — written 2026-10-28 from the researched tech map (MERN + TypeScript, Mongoose, RBAC, rotating-refresh JWT, aggregation, SSLCommerz sandbox primary / Stripe test secondary / bKash stub, Zod, Vitest/Supertest, Recharts, GitHub Actions, Upstash Redis, Socket.io, BullMQ, Resend, Docker). Free tiers only. If any gateway, quota, or version in this file has changed since it was written, the building agent must verify the current docs and report the change before proceeding.*
