# DokanOS — Multi-Tenant Inventory, POS & Baki (Credit) SaaS for Bangladeshi Retail Shops

![CI](https://github.com/razikuljoni/DokanOS/actions/workflows/ci.yml/badge.svg)
![TypeScript Strict](https://img.shields.io/badge/TypeScript-5.8%20strict-14532D)
![Stack](https://img.shields.io/badge/Stack-React%2019%20%C2%B7%20Express%205%20%C2%B7%20MongoDB%20%C2%B7%20Redis-1C1917)
![License: MIT](https://img.shields.io/badge/License-MIT-B45309)

![DokanOS Core Flow — POS Sale to Atomic Stock Decrement, Live Dashboard Update & Low-Stock Alert](./docs/dokanos-core-flow.svg)

---

## 1. What It Is

**DokanOS** is a multi-tenant inventory, counter point-of-sale (POS), supplier purchase order, and **Baki** (customer receivable / supplier payable credit) ledger SaaS built for small Bangladeshi retail shops—pharmacies, neighbourhood groceries (*mudi dokan*), and electronics stores.

### Live Demo & Credentials

- **Live App:** [https://dokanos.onrender.com](https://dokanos.onrender.com) *(or run locally with `pnpm dev`)*
- **Live API Health:** [https://dokanos.onrender.com/health](https://dokanos.onrender.com/health)
- **One-Click Demo Shop:** Click **"Try the demo shop"** on `/` or `/login` to sign directly into **Rahim Pharmacy (Mirpur-10, Dhaka)**—a pre-seeded Pro-plan pharmacy with 22 products, 3 suppliers, 45 days of sales history, and 8 open Baki accounts.
- **Demo Accounts:**
  - **Owner:** `demo@dokan-os.demo` / `Demo1234!`
  - **Manager:** `manager@dokan-os.demo` / `Manager1234!`
  - **Counter Staff:** `staff@dokan-os.demo` / `Staff1234!`

> **Free-Tier Wake-Up Note:** *First load may take up to a minute — the free server wakes up.* (Hosted on Render Free Web Service + Vercel Hobby + MongoDB Atlas M0 + Upstash Redis Free).

---

## 2. Why I Built It

Across Bangladesh, millions of neighbourhood pharmacies and retail shops still record daily sales and customer credit (*Baki*) in paper *khata* notebooks. Existing enterprise ERP tools are priced in USD, assume barcode-scanner hardware, and fail when shop internet drops for a few minutes.

DokanOS solves the three hardest operational problems for a single-counter or multi-staff Bangladeshi shop:
1. **Zero negative stock under concurrent counter sales:** Multiple staff ringing up the last medicine box simultaneously cannot oversell inventory.
2. **Unified Baki ageing ledger:** Customer credit sales and supplier purchase-order balances are tracked in one place with `0–7`, `8–30`, and `30+` day ageing buckets in Bangladeshi Taka (`৳`).
3. **Resilient offline counter & Baki outbox:** Temporary shop network outages do not halt the counter—POS sales and Baki collections queue locally in IndexedDB with client-generated idempotency keys and replay safely on reconnect.

---

## 3. Tech Stack

| Layer | Technology | Why It Was Chosen |
| :--- | :--- | :--- |
| **Monorepo & Types** | `pnpm` workspaces, TypeScript 5.8 (`strict: true`, `noUncheckedIndexedAccess: true`) | End-to-end type safety across `@dokanos/shared`, `apps/api`, and `apps/web`. |
| **Frontend** | React 19, Vite 6, Tailwind CSS v4, shadcn/ui primitives, TanStack Query v5, Zustand, React Hook Form, Recharts, `vite-plugin-pwa` | Fast counter UX, "Modern Ledger" warm-paper design system (`#FAF7F2` / `#1C1917` / `#14532D`), and offline outbox support. |
| **Backend** | Node.js 22, Express 5, Mongoose 8, Socket.io, Pino, Helmet, `express-rate-limit` | Native async error propagation in Express 5, replica-set transactions, and tenant-scoped realtime rooms. |
| **Database & Cache** | MongoDB Atlas M0 (512 MB replica set), Upstash Redis (free tier), BullMQ | Multi-document ACID transactions on M0 and serverless Redis for cache-aside + scheduled jobs. |
| **Payments & Email** | SSLCommerz Sandbox (BDT primary), Stripe Test Mode (secondary), bKash 501 stub, Resend Free Sandbox | Realistic Bangladeshi merchant checkout + international test card support at zero cost. |
| **Testing & CI/CD** | Vitest, Supertest, `mongodb-memory-server` (`MongoMemoryReplSet`), Playwright, GitHub Actions | Runs real multi-document MongoDB transactions in CI without external database dependencies. |

---

## 4. Documentation & Guides

For deep dives into the repository structure, contribution processes, and deployment checklists, consult the following dedicated guides:

- **[Architecture & Design Decisions](./ARCHITECTURE.md)** — System overview, data flows, multi-tenancy rules, and concurrency models.
- **[Contributing & Local Development Guide](./CONTRIBUTING.md)** — Step-by-step instructions for running the app locally, executing Vitest integration tests, and running Playwright E2E suites.
- **[Free-Tier Deployment Guide](./DEPLOYMENT.md)** — Complete instructions for deploying `apps/api` to Render and `apps/web` to Vercel on 100% free tiers.

---

## 5. License

Released under the [MIT License](./LICENSE).
