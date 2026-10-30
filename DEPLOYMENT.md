# DokanOS v1.0 — Free-Tier Deployment & Verification Guide

This guide walks through deploying **DokanOS** end-to-end on **100% free tiers** (MongoDB Atlas M0, Upstash Redis Free, Resend Free Sandbox, SSLCommerz Sandbox, Render Free Web Service, and Vercel Hobby) with zero paid accounts or credit cards required.

---

## Pre-Flight Release Checklist (Phase 6 Verification)

- [x] **Lockfile & Package Manager:** Single `pnpm-lock.yaml` at repo root (`packageManager: "pnpm@10.34.5"`), no `bun.lock` or `package-lock.json`; `pnpm install --frozen-lockfile` succeeds.
- [x] **Static Checks & Tests:** `pnpm lint`, `pnpm typecheck`, `pnpm --filter api test` (13/13 passing tests across 2 suites), and `pnpm build` all pass with zero errors.
- [x] **Multi-Tenant Isolation:** Every Mongoose query and IndexedDB cache key is scoped by `tenantId`; spoofed `X-Tenant-Id` headers return `403 TENANT_MISMATCH`.
- [x] **Auth Security:** `15m` JWT access tokens live in memory only (never `localStorage`/`sessionStorage`); `30d` refresh tokens are stored as `SHA-256` hashes in MongoDB and rotated via `httpOnly` cookie `dokanos_rt` with family reuse detection.
- [x] **Atomic Stock & Money Transactions:** POS sales, sale returns, purchase orders, and Baki due payments run inside MongoDB replica-set transactions with `$gte` stock guards.
- [x] **SSLCommerz Sandbox & Stripe Test Mode:** `/api/v1/billing/sslcommerz/success`, `/fail`, and `/cancel` accept both `GET` (browser redirect) and `POST` without requiring an `Authorization` header, validate and apply the 30-day Pro upgrade idempotently, and redirect to `${FRONTEND_URL}/app/billing`.
- [x] **PWA Offline Resilience:** Service worker precaches the app shell; POS and Baki Dues queue offline mutations with `idempotencyKey` deduplication and server-only invoice numbering.

---

## Step 1: Provision MongoDB Atlas M0 (Free Replica Set)

1. Sign in at [https://www.mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register) and create a **Free M0** cluster in `ap-south-1` (Mumbai) or `ap-southeast-1` (Singapore).
2. Under **Database Access**, create a database user (`dokanos_app`) with a strong password and `readWriteAnyDatabase` role.
3. Under **Network Access**, add `0.0.0.0/0` (required because Render Free uses dynamic outbound IPs).
4. Copy the connection string and append the database name `dokanos`:
   ```text
   mongodb+srv://dokanos_app:<PASSWORD>@cluster0.xxxxx.mongodb.net/dokanos?retryWrites=true&w=majority
   ```
   *(Note: Atlas M0 runs as a 3-node replica set out of the box, supporting multi-document Mongoose transactions natively.)*

---

## Step 2: Provision Upstash Redis (Free Tier)

1. Sign in at [https://console.upstash.com](https://console.upstash.com) and create a free Regional Redis database (`ap-southeast-1`).
2. Copy the **TLS Redis URL** (`rediss://default:<PASSWORD>@<ENDPOINT>.upstash.io:6379`) and set it as `UPSTASH_REDIS_URL`.
3. BullMQ in-process workers and the 60-second dashboard cache-aside layer connect to this URL automatically.

---

## Step 3: Provision Resend (Free Sandbox) & SSLCommerz Sandbox

1. **Resend Free Tier:** Create a free account at [https://resend.com](https://resend.com) and copy your API key (`re_...`) into `RESEND_API_KEY`. If omitted or set to `re_placeholder_key`, email digests log cleanly to `stdout` via Pino without failing jobs.
2. **SSLCommerz Sandbox (Free Developer Account):**
   - Register a free sandbox store at [https://developer.sslcommerz.com/registration/](https://developer.sslcommerz.com/registration/) **or** use the built-in public sandbox credentials (`SSLCZ_STORE_ID=testbox`, `SSLCZ_STORE_PASSWD=qwerty`, `SSLCZ_SANDBOX=true`).
   - Set the four callback URLs to your Render API base URL:
     - `SSLCZ_SUCCESS_URL=https://<your-render-api>.onrender.com/api/v1/billing/sslcommerz/success`
     - `SSLCZ_FAIL_URL=https://<your-render-api>.onrender.com/api/v1/billing/sslcommerz/fail`
     - `SSLCZ_CANCEL_URL=https://<your-render-api>.onrender.com/api/v1/billing/sslcommerz/cancel`
     - `SSLCZ_IPN_URL=https://<your-render-api>.onrender.com/api/v1/billing/sslcommerz/ipn`

---

## Step 4: Deploy `apps/api` to Render (Free Web Service)

1. In the [Render Dashboard](https://dashboard.render.com), click **New -> Web Service** and connect `https://github.com/razikuljoni/DokanOS`.
2. Configure the service:
   - **Name:** `dokanos-api`
   - **Region:** Singapore (`ap-southeast-1`)
   - **Branch:** `main`
   - **Root Directory:** *(leave blank — monorepo root)*
   - **Runtime:** `Node`
   - **Build Command:**
     ```bash
     corepack enable && pnpm install --frozen-lockfile && pnpm --filter @dokanos/shared build && pnpm --filter api build
     ```
   - **Start Command:**
     ```bash
     node apps/api/dist/server.js
     ```
   - **Instance Type:** `Free`
   - **Health Check Path:** `/health`
3. Add all environment variables from **Table B.1** below.
4. Once deployed, seed the demo shop (**Rahim Pharmacy**) once from your local terminal against the Atlas `MONGODB_URI`:
   ```bash
   MONGODB_URI="mongodb+srv://..." pnpm seed
   ```
   *(Or set `SEED_DEMO=true` in Render environment variables so the server seeds Rahim Pharmacy automatically if the database is empty.)*

---

## Step 5: Deploy `apps/web` to Vercel (Hobby Free Tier)

1. In the [Vercel Dashboard](https://vercel.com/new), import `https://github.com/razikuljoni/DokanOS`.
2. Configure the project:
   - **Framework Preset:** `Vite`
   - **Root Directory:** `apps/web`
   - **Install Command:** `pnpm install --frozen-lockfile`
   - **Build Command:** `pnpm --filter @dokanos/shared build && pnpm build`
   - **Output Directory:** `dist`
3. Set the environment variables from **Table B.2** below (`VITE_API_URL` and `VITE_SOCKET_URL` pointing to your Render service URL).
4. Deploy. Once Vercel assigns your production domain (e.g. `https://dokanos-web.vercel.app`), update `FRONTEND_URL` in Render to match it.

> **Clean Release Tree Note:** If deploying from an AI Studio export, run `bash scripts/prepare-release-tree.sh` on your release branch before pushing so AI Studio's preview harness files (`root server.ts`, `root index.html`, `root vite.config.ts`, `root metadata.json`) are excluded.

---

## Appendix B: Environment Variable Reference

### Table B.1 — Backend (`apps/api`) Environment Variables (Render)

| Variable | Required | Example / Default | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `production` | Enables secure cookies, production logging, and live SSLCommerz Sandbox API calls. |
| `PORT` | Yes | `4000` | HTTP port bound by Express + Socket.io (Render injects `PORT` automatically). |
| `MONGODB_URI` | Yes (Prod) | `mongodb+srv://.../dokanos` | MongoDB Atlas M0 replica-set connection URI. |
| `JWT_ACCESS_SECRET` | Yes | *(64-char random hex)* | Secret used to sign and verify 15-minute `HS256` access tokens. |
| `REFRESH_TOKEN_SECRET` | Yes | *(64-char random hex)* | Secret for refresh token signing context. |
| `COOKIE_SECRET` | Yes | *(64-char random hex)* | Secret passed to `cookie-parser`. |
| `FRONTEND_URL` | Yes | `https://dokanos.onrender.com` | Allowed CORS origin and redirect target after SSLCommerz payment callbacks. |
| `UPSTASH_REDIS_URL` | Optional | `rediss://default:...@...upstash.io:6379` | Redis connection URL for 60s dashboard cache-aside and BullMQ worker. |
| `RESEND_API_KEY` | Optional | `re_xxxxxxxxx` | Resend API key for low-stock and weekly digest emails (logs to stdout if placeholder). |
| `SSLCZ_STORE_ID` | Yes | `testbox` | SSLCommerz Sandbox Store ID (`testbox` or registered developer sandbox store). |
| `SSLCZ_STORE_PASSWD` | Yes | `qwerty` | SSLCommerz Sandbox Store Password (`qwerty` or registered sandbox password). |
| `SSLCZ_SANDBOX` | Yes | `true` | Must remain `true` so only SSLCommerz Sandbox endpoints are called. |
| `SSLCZ_SUCCESS_URL` | Yes | `https://dokanos.onrender.com/api/v1/billing/sslcommerz/success` | Public callback URL where SSLCommerz redirects/POSTs on successful payment. |
| `SSLCZ_FAIL_URL` | Yes | `https://dokanos.onrender.com/api/v1/billing/sslcommerz/fail` | Public callback URL for failed checkout attempts. |
| `SSLCZ_CANCEL_URL` | Yes | `https://dokanos.onrender.com/api/v1/billing/sslcommerz/cancel` | Public callback URL when a user cancels checkout. |
| `SSLCZ_IPN_URL` | Yes | `https://dokanos.onrender.com/api/v1/billing/sslcommerz/ipn` | Server-to-server Instant Payment Notification (IPN) endpoint. |
| `STRIPE_SECRET_KEY` | Optional | `sk_test_...` | Stripe test mode secret key for secondary card checkout. |
| `STRIPE_WEBHOOK_SECRET` | Optional | `whsec_...` | Stripe webhook signing secret for `/api/v1/billing/stripe/webhook`. |
| `SEED_DEMO` | Optional | `true` | Seeds **Rahim Pharmacy** demo data automatically if the database is empty. |

### Table B.2 — Frontend (`apps/web`) Environment Variables (Vercel)

| Variable | Required | Example / Default | Description |
| :--- | :--- | :--- | :--- |
| `VITE_API_URL` | Yes (Prod) | `https://dokanos.onrender.com` | Base URL for `/api/v1/*` requests (leave empty in local Vite proxy dev). |
| `VITE_SOCKET_URL` | Yes (Prod) | `https://dokanos.onrender.com` | Base URL for Socket.io realtime connection. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Optional | `pk_test_...` | Stripe test mode publishable key. |
