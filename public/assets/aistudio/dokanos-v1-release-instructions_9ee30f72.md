# DokanOS v1.0 Release — Build & Ship Guide

> **What this file is:** the complete, self-contained instruction set for taking the existing DokanOS repository from its current state to a **real v1.0 release** — Stitch-accurate UI on every screen, every gap from the first build plan closed, proper release documentation, and a live deployment. It is written to be pasted whole into a coding agent (Google AI Studio) and executed phase by phase, without any other context.
>
> **How to use it:** paste this whole file into the agent, then give this command:
>
> `Follow this guide phase by phase. Start with Phase 0. After each phase, run that phase's acceptance checks and report the results before continuing. Do not skip ahead. If a step is blocked, stop and report the blocker instead of inventing a workaround.`
>
> **Non-negotiable rules for the building agent:** everything must run on **free tiers only** — never create a paid account, never enter a payment method, never use a trial that converts to paid. Never put secrets in code or in any committed file. Never claim a feature works without running it. TypeScript `strict: true` everywhere. Every database query is scoped by `tenantId`. Small, incremental commits with clear messages (no more single giant bulk commits). Never delete a failing test to make CI green — fix the code or report the blocker.

---

## 0. Current state (read this first — do not rebuild what already exists)

**Repository:** `https://github.com/razikuljoni/DokanOS` (public, branch `main`).
**Base specification:** the original `dokanos-build-plan.md` (v1 plan) — its product, data model, API, payments, and phased plan are the foundation. This guide does **not** replace that plan; it finishes it and ships it.

**What is already built and verified (Oct 30, 2026, by code inspection):**
- pnpm workspaces monorepo: `apps/web` (React 19 + Vite 6, Tailwind v4, shadcn/ui, TanStack Query v5, Zustand, Recharts 3, Motion), `apps/api` (Express 5, Mongoose 8, MongoDB, Socket.io 4, BullMQ 5, ioredis, Stripe SDK test mode, Resend), `packages/shared` (Zod schemas + inferred types + RBAC matrix + plan constants).
- All 12 API modules with the planned endpoints: auth (register/login/refresh rotation + family reuse detection/logout/sessions), tenants (me/patch/usage/audit-logs), users (invite with setup link), products (low-stock, Pro CSV import/export, soft delete), stock (movements/adjust), sales (atomic transaction, sequential `INV-0001…` invoice numbers, return + restock), purchases, suppliers (+dues), dues (summary, ageing buckets 0–7 / 8–30 / 30+, record-payment), dashboard (aggregation pipelines, 60s Redis cache with `X-Cache: HIT | MISS`), notifications (unread-count/read-all/read), billing (SSLCommerz sandbox, Stripe test mode, bKash stub returning `501 NOT_CONFIGURED`).
- All 14 frontend routes, including `/app/products/:id` detail. All 8 test categories from the v1 plan §9 in `apps/api/tests/dokanos.test.ts` (tenant isolation, auth rotation + reuse, RBAC, parallel-sale concurrency, webhook replay, aggregation correctness, plan limits, Zod validation) + health test. 3 Playwright smoke tests. CI workflow (lint + typecheck + test + build), deploy workflow, e2e workflow, Docker + docker-compose, seed script (Rahim Pharmacy, 40 products, 120 sales, 3 suppliers, dues, notifications).
- All 4 BullMQ jobs (low-stock digest, due reminders, subscription expiry, weekly report) + Socket.io tenant rooms (`sale:created`, `stock:low`, `notification:new`).
- **Latest commit at time of writing:** `22186edf` — "feat: add PWA support for offline capability" (Oct 30, 2026). It added PWA icons, manifest wiring, `OfflineSyncManager`, `offlineCache`, `usePWAInstall`, `offlineStore`, and offline changes to the POS and Dues pages. **This PWA work is new and unverified — see Phase 1.**

**What is NOT done (the gaps this guide closes):**
1. **No real deployment.** The only live link anywhere is an AI Studio preview URL. There is no verified Vercel frontend or Render backend. The deploy workflow only fires a Render hook if secrets are set, has no Vercel step, and GitHub Actions has **zero recorded runs** — CI has never actually gone green.
2. **Payment callback bug (proven Oct 30 with a real sandbox payment).** A real SSLCommerz sandbox payment of ৳499 completed (test Visa card + OTP, gateway showed Success), but the shop stayed on free: the gateway's customer redirect arrives as **GET**, and GET `/billing/sslcommerz/success` falls through to the router-level `requireAuth` → **401**, so the callback never runs. The POST path works perfectly (free → Pro, expiry exactly +30 days; replays return `duplicate: true` with expiry unchanged). Also, the success handler redirects to a **relative** `/app/billing` on the API's own origin — in production that lands on the API domain, not the frontend.
3. **Dev-mode payment simulator gate.** The real sandbox call only runs when `NODE_ENV=production` AND the store is not the demo `testbox` account. In dev (or with demo creds) init always returns a local simulator URL. That is acceptable for demos, but it must be documented honestly, and the release must be proven against the real sandbox path (Phase 4).
4. **README has no GIF** of the core flow (required by v1 plan §13), and its "live demo links" are not real deployment links.
5. **Repo hygiene.** The repo was created with bulk commits (2 commits at first, then the PWA commit), not the small incremental commits the plan required. The root contains AI Studio preview harness files (`server.ts`, `index.html`, `vite.config.ts`, `metadata.json`, `public/assets/aistudio/…`) that are not part of the planned monorepo layout. A stray `bun.lock` was added by the PWA commit although the project uses pnpm — one package manager only.
6. **Architecture deviations (do not rewrite, but do not extend).** Route handlers hold logic inline instead of the planned thin-controller + module-service split, and the frontend has no `features/` folder (components are consolidated, e.g. `SharedWidgets.tsx`, instead of the named `DataTable`, `StatCard`, `SaleForm`, `DuePaymentDialog`, etc.). For this release: **do not refactor the whole codebase** — keep new code in the planned shape (services for new logic, named components for new UI) and note the deviation in the README's trade-offs section.
7. **PWA/offline claim is unproven.** Offline POS queueing is dangerous if it conflicts with the atomic stock transaction and sequential invoice numbering. It must be specified, tested, and proven safe — or gated off for v1.0 (Phase 1).

**Release scope — v1.0 IS:** Stitch-accurate UI on all screens; all fixes in §3; verified PWA (or gated off); complete release documentation; a live deployment on free tiers; a release tag + changelog.
**v1.0 is NOT (cut list, unchanged from the v1 plan):** live SMS, live payments on any gateway, multi-branch shops, Bangla UI translation, MFA, a mobile app, Redis pub/sub horizontal scaling, a separate worker service. If asked for any of these later, they are a new phase — not a silent addition.

---

## 1. Phase 0 — Baseline: prove the current tree before touching it

**Do, in this order:**
1. Clone the repo fresh. Delete `bun.lock` (pnpm is the only package manager). Regenerate the lockfile cleanly: remove `pnpm-lock.yaml`, run `pnpm install`, and confirm `pnpm install --frozen-lockfile` passes afterwards.
2. Run the full verification suite from the current tree: `pnpm lint`, `pnpm typecheck` (shared + api + web), `pnpm --filter api test`, `pnpm build` (both apps). Record the results.
3. Boot the stack locally (docker-compose mongo + redis, or local equivalents), run the seed, and click through every route with the demo login. Record anything that is broken **before** your changes, so you do not get blamed for pre-existing breakage — and so the release notes can list what was fixed.
4. Push a commit that triggers GitHub Actions for the first time and confirm the CI workflow actually runs. If CI fails, fix it in this phase — no phase is done on a red CI.

**Acceptance:** clean frozen install; lint + typecheck + API tests + both builds green; CI has at least one recorded run; a written baseline note (in the PR or commit message) lists every pre-existing breakage found.

## 2. Phase 1 — PWA: prove it or gate it

The PWA commit is the newest code and the riskiest claim. Do not build UI on top of it until it is verified.

**Do:**
1. Verify the PWA basics: `manifest` served correctly (name, icons 192/512/maskable, theme color, display mode), service worker registered in production build, install prompt works via `usePWAInstall`, and the app loads the shell offline (cached app shell, graceful offline state — never a blank page).
2. Write down the **offline behaviour specification** and implement exactly that — no more:
   - What works offline: viewing cached dashboard/products/sales lists (read-only, with a visible "Offline — showing cached data" banner).
   - What queues offline: POS sales and due payments, stored in `offlineStore`/`offlineCache` with a unique client-side idempotency key per queued action.
   - What happens on reconnect: queued actions sync in order through `OfflineSyncManager`; each syncs through the normal API (which still runs the atomic stock transaction server-side). If the server rejects a queued sale (e.g. stock is now 0), the item stays in the failed queue with the server's error shown — it must never silently drop, and it must never double-apply (the idempotency key is sent with the request and the server must reject a replay of the same key).
   - Invoice numbers are assigned **server-side only**, at sync time, in the server's sequence. Offline receipts show "Pending sync — invoice number assigned on sync", never a fake local invoice number.
3. Add tests: (a) a queued offline sale syncs once and decrements stock exactly once; (b) a duplicate sync of the same idempotency key is rejected/ignored; (c) a sale that fails server-side validation stays failed with its error visible. Run them in CI.
4. **If any of the above cannot be proven, gate offline submission off for v1.0:** offline mode becomes read-only (cached views + banner), the queue UI is hidden, and the README states plainly that offline sale submission ships in v1.1. Do not ship an unproven offline money path.

**Acceptance:** manifest + SW + install verified in a production build; the offline spec above is implemented and tested, or offline submission is gated off and documented; no offline flow can double-apply a sale or invent an invoice number.

## 3. Phase 2 — Stitch UI rebuild: every screen, as designed

This is the largest phase. The design reference is the set of Google Stitch projects in Appendix A (10 screens, "modern ledger" system). Use them as the visual reference for every screen. If a Stitch export is unavailable for any screen, build from the design system below — it is complete on its own and matches the Stitch brief.

### 3.1 Design system (do not deviate)
- **Style:** "modern ledger" — warm paper background `#FAF7F2`, ink text `#1C1917`, deep green primary `#14532D`, amber warning `#B45309`, red danger `#B91C1C`, hairline borders `#E7E0D4`, 8px radius, subtle shadows only.
- **Strictly forbidden (AI slop):** purple/blue gradients, glassmorphism, generic blue SaaS look, emoji icons, lorem ipsum, empty charts. Every screen shows realistic seeded data (Rahim Pharmacy).
- **Typography:** Space Grotesk for headings and display numbers; Inter for body/UI; `tabular-nums` for all money and stock figures. Currency: `৳` (BDT). Dates: Asia/Dhaka.
- **Layout:** desktop-first. Dark ink sidebar (`#1C1917`, white text) with shop switcher at the top; top bar with global search, notification bell (unread badge), and user menu. Dense, professional tables. Loading skeletons for every data view; friendly empty states ("No low-stock items — nice.") — never a blank page.
- **Motion (Motion / Framer Motion):** route fade/slide (150–200ms), sidebar collapse, POS cart line-item add animation, toast slide-in, modal scale/fade. Motion is for feedback, never decoration. Respect `prefers-reduced-motion`.
- **Dark mode:** design tokens must be CSS variables so dark mode is a token swap, not a rewrite. (A `.dark` token set already exists in the stylesheet — keep it working; do not break it.)
- **PWA install UI** (install button/banner from Phase 1) must use the same tokens and sidebar/topbar language — no default browser-style banner.
- **Known Stitch quirks (do not "fix" by inventing data):** the POS primary button reads **"Settle & Print Receipt"** (not "Complete sale") — use the Stitch label. The billing screen's seeded account is already on Pro, so it shows the annual-switch/Manage Plan control, not a Free-to-Pro button — keep both states implemented (Free view with upgrade button, Pro view with Manage Plan). The dashboard design shows the date "Friday, 24 May 2024" — cosmetic only; the app always shows the real Asia/Dhaka date.

### 3.2 Screen-by-screen checklist (all must be rebuilt or verified against Stitch)
| Route | Screen | Stitch reference | Must have |
|---|---|---|---|
| `/` | Landing page | Shop Ledger Landing Page | Hero, features, pricing Free/Pro ৳499/mo, footer, live-demo note (see §6 for the Render wake-up wording), "Try the demo shop" button |
| `/login`, `/register` | Auth screens, split layout | Authentication Portal | Split layout, demo login button, validation errors shown inline, Render wake-up note on login |
| `/app/dashboard` | Dashboard | Pharmacy Ledger Dashboard | Stat cards, revenue chart (Recharts, real aggregation data), top products, low-stock list, recent sales, low-stock banner |
| `/app/sales/new` | POS terminal | Pharmacy POS Terminal | Product search + cart + payment method + big total + **"Settle & Print Receipt"**, printable receipt modal, offline pending state from Phase 1 |
| `/app/sales` | Sales list + detail drawer | (POS design family) | Filters, pagination, sale detail drawer with invoice view + print |
| `/app/products` | Products table | Pharmacy Stock Ledger | Search, category/stock filters, sort, paginate, add/edit drawer, CSV import/export (Pro-gated with upgrade prompt on Free) |
| `/app/products/:id` | Product detail | Pharmacy Stock Ledger | Stock movements ledger, sales history |
| `/app/purchases` | Purchase orders + new purchase form | Purchases & Suppliers Ledger | Purchase form, stock increase + supplier due shown after receive |
| `/app/suppliers` | Supplier list + detail | Purchases & Suppliers Ledger | Total due per supplier, supplier detail + due history |
| `/app/dues` | Baki ledger | Baki Dues Ledger | Receivable + payable, ageing buckets 0–7 / 8–30 / 30+, record-payment dialog |
| `/app/alerts` | Notification feed | Alerts & Notifications Hub | Low stock, dues, payments; read/unread states, unread badge in topbar |
| `/app/billing` | Plan, usage, upgrade, invoice history | Billing Portal | Plan card, usage meters vs limits, upgrade via SSLCommerz sandbox / Stripe test mode (both labelled TEST/SANDBOX), invoice history, Free vs Pro states |
| `/app/staff` | Staff list, invite, role editor, permission matrix | Shop Settings Manager | Invite form (setup link shown in UI — no email in v1), role editor, disable, permission matrix |
| `/app/settings` | Shop profile, threshold, currency, sessions | Shop Settings Manager | Shop profile, low-stock threshold, currency, active sessions list with revoke |

### 3.3 Components (build once, reuse everywhere)
`AppShell` (sidebar + topbar), `DataTable` (server-side pagination, sorting, filters, bulk actions, CSV export button), `StatCard`, `ChartCard` (Recharts wrappers: line, bar, donut), `SaleForm` (multi-step POS), `ProductForm`, `DuePaymentDialog`, `LowStockBanner`, `NotificationBell`, `PlanBadge` (Free/Pro), `EmptyState`, `Skeleton`, `ConfirmDialog`, `Toast`. Where a consolidated component currently covers several of these, split it into the named components — this is the one structural cleanup required in this phase, because the release's component story is part of the portfolio story.
- **Server state:** TanStack Query everywhere. Query keys namespaced by tenant (`['products', tenantId, filters]`). Invalidate `dashboard` + `products` + `dues` after any sale/purchase/payment mutation. Optimistic updates only where rollback is implemented.
- **Client state:** Zustand for auth (in-memory access token only — never `localStorage`/`sessionStorage`) and UI (sidebar, toasts, offline banner). No Redux.
- **Forms:** React Hook Form + Zod, using the shared schemas from `packages/shared` — the same schema validates on client and server.
- **Realtime:** the existing `useSocket` hook — connects on login with the access token, joins the tenant room, listens for `sale:created`, `stock:low`, `notification:new`; updates the TanStack cache (no full refetch), shows a toast. Reconnect with backoff; on reconnect, refetch the dashboard.
- **Charts:** Recharts 3 — revenue line (daily), top-products bar, category donut, dues ageing bar. All fed by the aggregation endpoints. Never hardcode chart data.

**Acceptance:** every route above matches its Stitch screen's layout, tokens, and components (screenshot-compare each route against its Stitch export and list any deliberate deviation with a reason); no forbidden-slop element remains; no screen is empty without seed data; all tests still pass.

---

## 4. Phase 3 — Fixes carried from the v1 plan and the Oct 30 payment proof

These are not optional polish. Each item below was found by inspection or by a real sandbox payment run. Fix all of them in this phase, with a test or a live verification for each.

### 4.1 Payment callback: accept the browser redirect (critical)
**Problem (proven):** after a real SSLCommerz sandbox payment, the shop stayed on free and the payment stayed `pending`. The gateway's customer redirect arrives as **GET**, but `/billing/sslcommerz/success` (and `/fail`, `/cancel`) are POST-only, and a GET falls through to the router-level `requireAuth` → **401**. The POST path works (free → Pro, +30 days exactly; replays return `duplicate: true`).
**Fix:**
1. Register GET handlers for `/billing/sslcommerz/success`, `/fail`, and `/cancel` alongside the POST handlers. The GET handler reads `tran_id` (and `val_id` if present) from the query string and runs the **same** `validateAndApplySslCommerzPayment` path as the POST handler — no duplicated logic.
2. Keep the POST handlers exactly as they are (IPN and form POSTs must keep working).
3. The success redirect must go to the **frontend**, not a relative path: redirect to `${FRONTEND_URL}/app/billing?status=success&tran_id=…` (and `status=failed` / `status=cancelled` for the other two). The current relative `/app/billing` redirect lands on the API's own domain in production and shows a dead page.
4. Add tests: (a) GET success with a valid `tran_id` + matching amount/currency applies the payment; (b) GET success with an unknown `tran_id` returns 404 and changes nothing; (c) the redirect target starts with `FRONTEND_URL`.
5. **Do not break idempotency:** the existing guards (unique `{ provider, eventId }` index, atomic `pending → paid` transition, early return when already `paid`) stay exactly as they are. Re-run the replay tests after this change.

### 4.2 Payment simulator gate: document it, do not silently change it
The real sandbox call only runs when `NODE_ENV=production` AND the store is not the demo `testbox` account; otherwise init returns a local simulator URL. **Keep this behaviour** (it is correct for a demo), but:
1. Document it in the README's billing section and in `apps/api/.env.example` comments: dev + demo creds = simulator; production + real store creds = real gateway.
2. The billing page must label the simulator clearly ("Sandbox simulator — no real gateway call in development") so a demo user is never misled.
3. The release proof (Phase 5) must run against the **real** sandbox path, not the simulator.

### 4.3 Deployment wiring (do the work, not just the workflow file)
1. Add a real Vercel step to the deploy workflow (or document Vercel Git integration as the chosen mechanism — pick one, do not leave both half-done). The Render deploy-hook step stays, but it must only run when the secret exists **and** the hook URL is verified to exist.
2. After wiring, the deploy workflow must run at least once successfully on a test push before release. A workflow that has never run is not a deployment story.
3. Add a post-deploy smoke check to the workflow: `GET <render-url>/health` returns `{ "ok": true }`, and the frontend URL returns 200. Fail the workflow if either fails.

### 4.4 Repo cleanup (release tree must match the plan's layout)
1. Remove the AI Studio preview harness files from the release tree: root `server.ts`, root `index.html`, root `vite.config.ts`, root `metadata.json`, `public/assets/aistudio/`. (If the build environment needs them during development, keep them out of the release branch/commit — the release tree is what deploys to Vercel/Render.)
2. Confirm the release tree matches the v1 plan §2 layout (`apps/web`, `apps/api`, `packages/shared`, `docker-compose.yml`, `.github/workflows/`, `.env.example` files). List any remaining deviation in the README.
3. Restore small, incremental commits from here on: one commit per phase (or per screen in Phase 2), messages like `feat(billing): accept GET on sslcommerz success callback`. Never another bulk import.

### 4.5 Small correctness items (verify each, fix if broken)
- Demo login ("Try the demo shop") works from the landing page and the login screen, for all three demo roles.
- Plan limits enforced server-side with `403 PLAN_LIMIT` (free: 100 products, 1 staff besides owner, no CSV import, no dues-reminder email; Pro: unlimited products, 5 staff, CSV import/export, email digests) and an upgrade prompt in the UI when hit.
- Rate limits from v1 plan §4 (global 300/15 min per IP; auth 10/15 min per IP; billing init 20/hour per user) and the central error format `{ error: { code, message } }` with stable codes (`VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `PLAN_LIMIT`, `INSUFFICIENT_STOCK`, `TENANT_MISMATCH`). No stack traces to the client.
- The Render wake-up note is visible on the landing page and the login screen: "First load may take up to a minute — the free server wakes up." No uptime-pinger hacks.
- Seed script is idempotent (safe to re-run; the demo tenant is skipped if already seeded).

**Acceptance:** GET success applies a payment (test); redirect goes to the frontend URL (test); replay tests still pass; deploy workflow has run successfully at least once; release tree contains no AI Studio harness files and no `bun.lock`; all §4.5 items verified by hand.

## 5. Phase 4 — Re-prove payments end to end (real sandbox, not the simulator)

Do not ship v1.0 on the word of the unit tests. Re-run the proof that found the §4.1 bug, against the fixed code:
1. Run the API with a production-style environment and the SSLCommerz sandbox demo store (`testbox` is acceptable for the sandbox proof — the sandbox API accepts it and returns a real gateway URL) or real sandbox store credentials if available.
2. Register a fresh free-plan shop. Record plan = `free`, `planExpiresAt` = null.
3. Initiate billing and confirm the init returns a **real** `sandbox.sslcommerz.com` gateway URL (not the local simulator URL).
4. Complete the payment on the gateway with the official sandbox test card (Appendix C). Record the gateway's Success confirmation.
5. Verify server-side, from the database/API (not from the browser): the Payment row is `paid`, the tenant is `pro`, and `planExpiresAt` is exactly 30 days from the payment time.
6. Replay the same callback (same `tran_id`) via the IPN endpoint and via the success endpoint. Verify both return `duplicate: true` (or the success redirect) and `planExpiresAt` is **unchanged** — one 30-day extension, not 60.
7. Verify the customer-facing redirect lands on the **frontend** billing page showing the Pro plan — not on the API domain, not on a 401 page.
8. Repeat steps 3–5 for a Stripe test-mode payment (test card `4242 4242 4242 4242`) if the Stripe provider is wired; if it is not fully wired, say so in the README and do not claim it.

**Acceptance:** a written proof note (in the release PR or CHANGELOG) with the shop name, `tran_id`, amount, before/after plan + expiry, and the replay result. Any step that fails is a release blocker.

## 6. Phase 5 — Release documentation (the release is not done without this)

### 6.1 README v2 (the resume case study — rewrite, do not just append)
The README must contain, all verified by clicking/running before release:
1. One-line pitch + **live demo links (frontend URL, API health URL)** + demo login credentials (all three roles).
2. The problem and who it is for (small Bangladeshi shops, paper khata → digital ledger).
3. An architecture diagram (monorepo, request flow, where each technology lives) — updated to include the PWA layer and the fixed callback flow.
4. The feature list grouped by module.
5. The hardest decisions and trade-offs, **including the ones found during this release**: why transactions not Redis locks for stock; why the BullMQ worker is in-process on the free tier; why SSLCommerz is primary and Stripe is test-only; why subscriptions are repeated one-off 30-day payments; why the payment callback accepts GET as well as POST; why offline submission is on or off for v1.0; and the architecture deviations noted in §0 (route-handler logic, consolidated components).
6. How to run locally (prereqs, env, seed, `pnpm dev`) — every command re-run from scratch on a clean checkout before release.
7. The test story (what is tested and why, including the new callback and offline tests).
8. **A GIF of the core flow** (POS sale → dashboard update → low-stock alert). This was required by the v1 plan and is still missing — record it from the deployed demo, not from localhost, if possible.
9. Honest limits (Render sleep, no live payments, no SMS, sandbox/test-mode only, PWA status). No dead links — every link in the README must be clicked and verified before release.

### 6.2 CHANGELOG.md
- `v1.0.0` entry: what shipped, the Stitch UI rebuild, the payment callback fix, the PWA status, and every fix from Phase 3 with its proof note reference.
- `Unreleased` section at the top for anything that lands after the tag.

### 6.3 DEPLOYMENT.md
Step-by-step, copy-pasteable: Vercel (project setup, root directory `apps/web`, build `pnpm build`, output `dist`, env vars), Render (service setup, root `apps/api`, build `pnpm install && pnpm build`, start `node dist/server.js`, deploy hook secret), MongoDB Atlas M0 (cluster, network access, connection string, note that it is a replica set so transactions work), Upstash Redis (URL, quota note), Resend (key, sender, sandbox-sender note until a domain is verified), SSLCommerz sandbox (where to get store credentials, sandbox vs live distinction), and the post-deploy smoke check. Include the full environment variable tables from Appendix B.

### 6.4 Release tag and notes
- Tag `v1.0.0` on the release commit. GitHub release notes = the CHANGELOG v1.0.0 entry + demo links + demo logins + the GIF.
- The release notes must state plainly: sandbox/test-mode payments only, no real money, no live SMS.

**Acceptance:** README v2, CHANGELOG.md, and DEPLOYMENT.md exist and every command/link in them has been executed/clicked; the GIF exists and shows the real flow; the `v1.0.0` tag exists.

## 7. Phase 6 — Go live (the user will do this part — make it foolproof)

The agent's job in this phase is to prepare everything so the user can deploy without debugging. Do not ask the user for secrets in chat — they enter them in the Vercel/Render/Atlas dashboards.

**Pre-flight checklist for the user (put this at the top of DEPLOYMENT.md):**
- [ ] GitHub repo is the cleaned release tree (no AI Studio harness files, no `bun.lock`, no `.env` committed — check with `git status` and `git ls-files | grep -i env`).
- [ ] Vercel project connected to the repo, root directory `apps/web`, env var `VITE_API_URL` set to the Render URL, `VITE_SOCKET_URL` set to the same.
- [ ] Render web service created from the repo, root directory `apps/api`, build `pnpm install && pnpm build`, start `node dist/server.js`, all API env vars set (Appendix B), deploy hook URL copied into the GitHub secret `RENDER_DEPLOY_HOOK_URL`.
- [ ] MongoDB Atlas M0 cluster created, database user created, network access allows Render (or 0.0.0.0/0 for the demo with a note that this is demo-only), connection string in `MONGODB_URI`.
- [ ] Upstash Redis database created, `rediss://` URL in `UPSTASH_REDIS_URL` (app must still boot if Redis is unreachable — cache degrades to miss, rate limiting to in-memory, with a warning logged, never a crash).
- [ ] Resend API key created (free tier), `RESEND_API_KEY` set; sender is the Resend sandbox sender until a domain is verified.
- [ ] SSLCommerz sandbox store credentials obtained (free self-serve sandbox account at `https://developer.sslcommerz.com`; sandbox gateway `https://sandbox.sslcommerz.com`). Store ID/password go in `SSLCZ_STORE_ID` / `SSLCZ_STORE_PASSWD`; `SSLCZ_SANDBOX=true`; success/fail/cancel/IPN URLs point at the **deployed Render URL**, not localhost.
- [ ] Stripe test keys (`sk_test_…`, `whsec_…`) set if Stripe test mode is claimed; every Stripe surface in the UI labelled **"TEST MODE"**.
- [ ] Seed run once on the deployed database (demo tenant Rahim Pharmacy, demo logins working).
- [ ] Post-deploy smoke: `GET <render-url>/health` → `{ "ok": true }`; frontend loads; demo login lands on the dashboard with data; one POS sale decrements stock and appears on the dashboard; one SSLCommerz sandbox payment upgrades a test shop to Pro (Phase 4 proof, re-run against the deployed URLs).
- [ ] Landing page and login screen show the Render wake-up note.
- [ ] GitHub release `v1.0.0` published with demo links and the GIF.

**Acceptance:** every checkbox above is either checked by the user or explicitly marked as deferred with a reason in the release notes. Nothing is silently skipped.

## 8. Phase 7 — Release acceptance (all must pass before calling it v1.0)

1. All routes match their Stitch screens; no forbidden-slop element; no empty screen without seed data.
2. Payment callback fix proven end to end against the real sandbox (Phase 4 proof note exists).
3. PWA proven or gated off (Phase 1 decision recorded in README).
4. CI green on the release commit, deploy workflow has run successfully, post-deploy smoke passes.
5. README v2 + CHANGELOG.md + DEPLOYMENT.md complete, every link clicked, GIF recorded.
6. Release tree is clean (no harness files, no `bun.lock`, no committed secrets, single package manager).
7. `v1.0.0` tag published with release notes.
8. Known limits are stated honestly in README and release notes (Render sleep, sandbox/test-mode only, no SMS, PWA status).

If any item fails, the release is not v1.0 — it is a release candidate. Say so plainly and list the failing items.

---

## Appendix A — Stitch design links (all 10 screens, "modern ledger" system)

Every project's export panel offers Figma, Code to Clipboard, .zip, and AI Studio. No sign-in was needed and nothing was paid for these designs. No separate Figma file was created (that needs a Figma account connected); code export is clipboard-based.

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

Notes from the designs: two label differences from the original spec — the POS primary button reads "Settle & Print Receipt" (not "Complete sale"), and the billing screen shows the annual-switch/Manage Plan control because its seeded account is already on Pro (no Free-to-Pro button in that shot). The dashboard design shows the date "Friday, 24 May 2024" instead of the current date — cosmetic only. Design tokens: paper `#FAF7F2`, ink `#1C1917`, primary green `#14532D`, amber `#B45309`, danger `#B91C1C`, borders `#E7E0D4`, radius `8px`; Space Grotesk (display) + Inter (UI); currency `৳`; timezone `Asia/Dhaka`.

## Appendix B — Environment variables (never committed — provide `.env.example` files)

**API (`apps/api/.env`):** `PORT` (4000), `NODE_ENV` (development | production), `MONGODB_URI` (Atlas connection string), `JWT_ACCESS_SECRET` (random 64-char string), `REFRESH_TOKEN_SECRET` (random 64-char string), `COOKIE_SECRET` (random 64-char string), `FRONTEND_URL` (localhost:5173 in dev / Vercel URL in prod — the only allowed CORS origin), `UPSTASH_REDIS_URL` (Upstash `rediss://` URL, optional in dev), `RESEND_API_KEY` (optional until email is used), `SSLCZ_STORE_ID`, `SSLCZ_STORE_PASSWD`, `SSLCZ_SANDBOX` (`true`), `SSLCZ_SUCCESS_URL`, `SSLCZ_FAIL_URL`, `SSLCZ_CANCEL_URL`, `SSLCZ_IPN_URL` (all `${API_URL}/api/v1/billing/sslcommerz/...`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Stripe **test** keys `sk_test_…`, `whsec_…`), `SEED_DEMO` (`true` to run the seed script on first boot, dev only).

**Web (`apps/web/.env`):** `VITE_API_URL` (Render URL in prod, `http://localhost:4000` in dev), `VITE_SOCKET_URL` (same as API URL), `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`, only if Stripe checkout is wired).

## Appendix C — Demo accounts & test payments (sandbox/test mode only — no real money)

**Demo logins (seeded tenant "Rahim Pharmacy", Mirpur, Dhaka, Pro plan):**
- Shop Owner: `demo@dokan-os.demo` / `Demo1234!`
- Store Manager: `manager@dokan-os.demo` / `Demo1234!`
- Counter Staff: `staff@dokan-os.demo` / `Demo1234!`

**SSLCommerz sandbox (official sandbox docs):** Visa `4111111111111111`, Mastercard `5111111111111111`, Amex `371111111111111`, expiry `12/26`, CVV `111`, OTP `111111` or `123456`. Sandbox gateway: `https://sandbox.sslcommerz.com`. Honest limits: sandbox only; live SSLCommerz needs a registered business, bank account, and documents. No auto-renewal — Pro is a 30-day period per payment, with a reminder 3 days before expiry.

**Stripe test mode:** card `4242 4242 4242 4242`; decline `4000000000000002`; 3DS `4000002500003155`. Label every Stripe surface **"TEST MODE"**. Honest limits: Bangladesh is not on Stripe's supported-country list — live Stripe payouts to a Bangladeshi business are impossible; Stripe here proves international billing skill, not a live option. Do not falsify jurisdiction or country during signup; if signup blocks Bangladesh, document it in the README and keep SSLCommerz as the only live demo path.

**bKash:** stub only — `createCheckout` returns `501 NOT_CONFIGURED`. Do not wire a live or sandbox bKash flow.

## Appendix D — Known issues log (from the Oct 30, 2026 audit + payment proof)

| # | Issue | Status at time of writing | Must be fixed in this release? |
|---|---|---|---|
| 1 | SSLCommerz customer redirect arrives as GET → 401 from router-level `requireAuth` → payment stays pending | Open, root cause proven | **Yes — Phase 3 (§4.1)** |
| 2 | Success handler redirects to relative `/app/billing` on the API origin instead of the frontend | Open, root cause proven | **Yes — Phase 3 (§4.1)** |
| 3 | Real sandbox call gated behind `NODE_ENV=production` + non-demo store; dev always uses the simulator | By design, but undocumented | Document + prove real path — Phase 3 (§4.2), Phase 4 |
| 4 | No real deployment (only AI Studio preview URL); deploy workflow never run; CI zero runs | Open | **Yes — Phase 3 (§4.3), Phase 6** |
| 5 | README has no GIF; "live demo links" are not real deployment links | Open | **Yes — Phase 5** |
| 6 | Root AI Studio harness files + stray `bun.lock` in the release tree | Open | **Yes — Phase 3 (§4.4)** |
| 7 | Bulk commits instead of small incremental commits | Process issue | From here on — Phase 3 (§4.4) |
| 8 | Route handlers hold logic inline (no service layer); frontend has no `features/` folder | Deviation, not a bug | Do not refactor wholesale; new code follows the planned shape; note in README |
| 9 | PWA offline sale sync unproven (double-apply / invoice-number risks) | Open, new in latest commit | **Yes — Phase 1: prove or gate** |

---
*DokanOS v1.0 Release Guide — written 2026-10-30 from the latest repository state (commit `22186edf`, PWA support), the original v1 build plan, the Oct 30 code audit, and the Oct 30 real sandbox payment proof. Free tiers only. If any gateway, quota, or version in this file has changed since it was written, the building agent must verify the current docs and report the change before proceeding.*
