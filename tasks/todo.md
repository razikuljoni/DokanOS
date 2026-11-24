# Task List

## Phase 3: Real Payments
- [ ] Task 3.1: SSLCommerz real init & validation enforcement (`val_id` check, tenant customer fields, error logging & error state surfacing)
- [ ] Task 3.2: Gateway cleanup (bKash "Coming Soon" modal/badge, remove Nagad mentions)
- [ ] Task 3.3: Billing UI fixes (DEV-ONLY sandbox modal, test details auto-fill, FAILED/CANCELLED history status, 15m reconciliation job, "Annual (365 days)" label)
- [ ] Checkpoint 3: Tests green (`pnpm --filter api test`), typecheck, build clean, commit Phase 3

## Phase 4: Settings, Loading, Responsive & Navigation
- [ ] Task 4.1: Tenant settings fields (address, helpline, trade licence) persistence & fix timeout
- [ ] Task 4.2: Loading skeletons across pages & fix plan limit/label UI
- [ ] Task 4.3: Navigation & feature details (Customers nav item, supplier detail view, categories handling, `/app/pos` redirect)
- [ ] Task 4.4: Responsive UI (360/390/768/1024/1440px) & viewport tests
- [ ] Checkpoint 4: Tests green (`pnpm --filter api test`), lint, typecheck, build clean, commit Phase 4

## Phase 5: CI & Cancellation
- [ ] Task 5.1: `.github/workflows/deploy.yml` smoke job failure on missing deploy hook secret
- [ ] Task 5.2: "Cancel at end of period" option in API and UI
- [ ] Task 5.3: Verify workspace package version alignment
- [ ] Checkpoint 5: Full verification (`pnpm lint && pnpm typecheck && pnpm --filter api test && pnpm build`), commit Phase 5
