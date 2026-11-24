# DokanOS Execution Todo List

## Phase 3: Real Payments & Gateway Cleanup
- [x] val_id required in non-prod; Nagad removed; FAILED/CANCELLED history; annual label; reconciliation job; sandbox modal DEV-only
- [ ] 3A: Replace hardcoded customer phone/address/city with tenant fields (`billing/routes.ts:368-370`, `AlertsAndBillingPages.tsx:749/751/756/758`)
- [ ] 3B: Log SSLCommerz init request/response (never store password); surface real error when gateway returns no checkout URL
- [ ] 3C: bKash — remove 501 stub button or show "Coming soon — needs merchant onboarding"; remove landing-page bKash claims (lines 296/318/467/562)
- [ ] Checkpoint 3: full verification + commit

## Phase 4: Settings, Loading, Responsive & Navigation
- [x] Supplier detail view + `/app/pos` redirect (`3ea530c`); Customers nav already present; skeletons in DataTable
- [ ] 4A: Diagnose & fix Save timeout root cause
- [ ] 4B: Remove permanently disabled Danger Zone buttons (Transfer Ownership L1984, Delete Shop L2009) or implement
- [ ] 4C: Remove ৳0 / "0-Unlimited" fallbacks before query resolves (`DashboardPage.tsx:159-162`, billing `?? 0` L1077/1097) + test
- [ ] 4D: Fix plan-label mismatch (dashboard PRO badge vs Billing Free)
- [ ] 4E: Playwright viewport tests at 360/390/768/1024/1440px, no horizontal overflow
- [ ] 4F: Document categories free-text decision
- [ ] Checkpoint 4: full verification + commit

## Phase 5: CI & Cancellation
- [x] deploy.yml fails on missing secret (`acaf897`); versions aligned; cancel option added
- [ ] 5A: Show effective date on "Cancel at End of Period"
- [ ] Checkpoint 5: full verification + commit