# DokanOS Agent Notes

## Architecture

- **API Entry Points:** `apps/api/src/server.ts` is the dev bridge, but the real Express 5 app lives in `apps/api/src/app.ts` and exports `apiApp` as the router.
- **Auth & Tenant Flow:** Auth middleware (`apps/api/src/middleware/auth.ts`) verifies JWT in `authMiddleware`; `requireTenant` then resolves `req.tenant` from the JWT claim. RBAC middleware enforces permissions against shared RBAC matrix (`@dokanos/shared`).
- **Request Flow:** Express request hits auth middleware -> tenant middleware -> domain router (`apps/api/src/modules/*/routes.ts`) -> Mongoose model -> MongoDB transaction.
- **Frontend Entry Points:** `apps/web/src/main.tsx` mounts React at `#root`, gets API URL from `VITE_API_URL` env var (defaults to localhost:4000 in dev).
- **Shared Contracts:** All validation schemas, RBAC permissions, and plan limits (`@dokanos/shared`) imported by both API and web.
- **Offline Resilience:** React service worker uses tenant-scoped IndexedDB (`dokanos-offline-ledger-v1`) for local POS/sales snapshots during connectivity loss.
- **Real-time:** Socket.io server in `apps/api/src/realtime/socket.ts`; tenants get their own isolated room via `tenantId`.

## Commands

- Install: `corepack enable && pnpm install --frozen-lockfile`.
- Full local dev: `pnpm dev` (unified server on `http://localhost:3000` with Vite middleware in dev, static `dist` in prod; auto-seeds demo data if `SEED_DEMO=true`).
- Validation order, matching CI: `pnpm lint && pnpm typecheck && pnpm --filter api test && pnpm build`.
- API tests only: `pnpm --filter api test`; focused test file: `pnpm --filter api test tests/health.test.ts`.
- E2E: install browser once with `npx playwright install --with-deps chromium`, then run `pnpm test:e2e`. Set `PLAYWRIGHT_BASE_URL` to test a running deployment; default is `http://localhost:3000`.
- Format: `pnpm format`.

## Runtime and config

- Split dev: copy env examples, then `pnpm --filter api dev` + `pnpm --filter web dev` (different ports: 4000 + 5173).
- MongoDB replica set required for transactions. Use `MONGODB_URI` for production; local dev uses `MongoMemoryReplSet`.
- Redis (`UPSTASH_REDIS_URL`) optional; enables 60-second dashboard cache and in-process BullMQ workers.
- `.env.example` files exist in both API and web; `.env.local` (gitignored) overrides defaults.
- Billing providers: `SslCommerzBillingProvider` (BDT primary), `StripeTestBillingProvider` (USD secondary), plus stubbed `BkashStubBillingProvider`.

## Testing peculiarities

- Integration tests use `MongoMemoryReplSet` to avoid external dependencies; they verify tenant isolation, parallel-sale concurrency, auth refresh reuse detection, and webhook replay idempotency.
- Playwright E2E tests run in CI with `--with-deps chromium`; they use a demo shop (`Rahim Pharmacy`) for end-to-end flows.
- Tests assume shared package is built first (`pnpm --filter @dokanos/shared build`) before running API or web tests.

## Deployment quirks

- Build order: `pnpm --filter @dokanos/shared build` (shared schemas) -> `pnpm --filter api build` -> `pnpm build` (web).
- Render Free deploys `apps/api` with `pnpm --filter @dokanos/shared build && pnpm --filter api build`, then runs `node apps/api/dist/server.js`.
- Vercel Hobby deploys `apps/web` with same build order; environment variables (`VITE_API_URL`) set in Vercel dashboard.
- AI Studio release trees need `bash scripts/prepare-release-tree.sh` before pushing to remove preview harness files (`root server.ts`, `root index.html`, etc.).
- SSLCommerz sandbox calls require `SSLCZ_SANDBOX=true`; both testbox/qwerty and registered developer credentials work.
- Auth tokens are memory-only (Zustand `authStore.ts`); refresh tokens stored as SHA-256 hashes in MongoDB, rotated every `30d`.
- Tenant scoping is enforced at both middleware (`requireTenant`) and query level (`tenantId` indexed in every model).
