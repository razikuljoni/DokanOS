# Implementation Plan: DokanOS Fixes - Phases 3, 4, 5

## Overview
Complete implementation of Phases 3, 4, and 5 from `dokanos-fix-plan-v2.md` on the `dev` branch.

## Phases & Tasks

### Phase 3 — Real Payments
- Task 3.1: SSLCommerz init request/response logging, tenant customer details requirement, error surfacing for blank/failed checkout URL, strict `val_id` validation.
- Task 3.2: Clean up bKash (501 stub -> coming soon notification / non-payable state) & Nagad (remove all mentions from landing/billing UI).
- Task 3.3: Sandbox simulator DEV-ONLY guard, official test detail auto-fill, fix payment history status display (FAILED/CANCELLED instead of PENDING), 15-min stale payment reconciliation, and annual plan label fix ("Annual (365 days)").
- Verification 3: Run API tests, build, and verify checkout flow. Commit Phase 3 as `fix(phase3): real sslcommerz validation, payment status reconciliation, and gateway cleanup`.

### Phase 4 — Settings, Loading, Responsive & Navigation
- Task 4.1: Fix Tenant Settings (address, helpline, trade licence persistence & save timeout fix).
- Task 4.2: Add loading skeletons for dashboard/sales/products/billing; fix plan label display mismatches.
- Task 4.3: Add Customers nav item, supplier detail view, categories free-text/model support, `/app/pos` -> `/app/sales/new` redirect.
- Task 4.4: Responsive layout fixes (360/390/768/1024/1440px) & Playwright viewport checks.
- Verification 4: Run typecheck, lint, API tests, E2E tests, build. Commit Phase 4 as `fix(phase4): tenant settings persistence, responsive layout, and navigation fixes`.

### Phase 5 — CI & Cancellation Options
- Task 5.1: Update `.github/workflows/deploy.yml` so smoke deploy job FAILS when `RENDER_DEPLOY_HOOK_URL` is unset instead of skipping silently.
- Task 5.2: Add "Cancel at end of period" option to billing cancellation alongside immediate cancel.
- Task 5.3: Verify version alignment across workspace manifests.
- Verification 5: Full test suite, lint, typecheck, build. Commit Phase 5 as `fix(phase5): enforce deploy workflow secrets and period-end billing cancellation`.
