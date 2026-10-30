# Contributing to DokanOS

Thank you for your interest in contributing to **DokanOS**! This guide details how to set up the development environment, execute the test suites, and follow our contribution standards.

---

## 1. Prerequisites

Before starting, ensure you have the following installed:
- **Node.js:** `v22` or later
- **pnpm:** `v10` or later (enable with `corepack enable`)
- **Docker & Compose:** (Optional, but recommended for Redis & MongoDB replica set setups)

---

## 2. Local Setup & Running Locally

### Option A: In-Memory Database (No Setup Required)

If you don't have MongoDB or Redis installed locally, DokanOS will spin up an in-memory replica set (`MongoMemoryReplSet`) and default to direct worker execution automatically.

```bash
# Enable corepack and install packages
corepack enable
pnpm install --frozen-lockfile

# Run both the Express API and Vite Dev servers with a single command
pnpm dev
```

This starts the unified backend on `http://localhost:4000` and the Vite frontend on `http://localhost:5173` with a proxy bridge on `http://localhost:3000`. It automatically seeds a demo pharmacy:
- **Username:** `demo@dokan-os.demo`
- **Password:** `Demo1234!`

### Option B: With Docker Compose (Production-Like)

To run with persistent, local instances of MongoDB 7 and Redis 7:

```bash
# Spin up services
docker compose up -d

# Copy environment files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Install and build packages
pnpm install --frozen-lockfile
pnpm --filter @dokanos/shared build

# Seed sample store
pnpm seed

# Start development servers
pnpm --filter api dev
pnpm --filter web dev
```

---

## 3. Test Suites & Verification

Always run local validation commands before committing. Our CI pipeline expects all tests and checks to pass cleanly.

### Integration & Isolation Tests (Vitest)

Runs our 13+ tenant isolation, security, and stock concurrency tests on an in-memory database replica:

```bash
pnpm --filter api test
```

### End-to-End Tests (Playwright)

To execute browser E2E workflows locally:

```bash
# Install Playwright browser dependencies (only once)
npx playwright install --with-deps chromium

# Execute E2E tests
pnpm test:e2e
```

### Static Checks (TypeScript & Linter)

```bash
pnpm lint
pnpm typecheck
```

---

## 4. Code & Contribution Workflow

To keep the repository clean and maintainable, please follow these guidelines:

### Branch Naming
Use descriptive prefixes for your branch names:
- `feature/<short-desc>` (e.g., `feature/barcode-scanner`)
- `fix/<short-desc>` (e.g., `fix/due-ledger-balance`)
- `chore/<short-desc>` (e.g., `chore/update-deps`)

### Commit Messages
We enforce structured, atomic commit messages following conventional standards:
- `feat: ...` for a new feature.
- `fix: ...` for a bug fix.
- `refactor: ...` for code quality or restructuring with no external behavior changes.
- `test: ...` for adding or modifying test coverage.

Example:
```text
feat: add barcode scan support to POS checkout page

- Implemented standard scan listener on the sale checkout page.
- Auto-resolves product SKU with focus restoration.
```

---

## 5. Development Standards

- **Tenant Boundary:** Every new mongoose model or query MUST include and filter by a required `tenantId`.
- **Atomic Operations:** Never perform read-then-write updates for stock or currency balances. Use MongoDB transactions and `$inc` atomic decrements with `$gte` stock checks.
- **In-Memory Tokens:** Avoid storing JWT access tokens anywhere on the client disk or storage layers.
- **Keep it Simple:** Avoid introducing extra dependencies. Stick to the standard library or pre-installed modules.
- **Keep Lint Clean:** Fix all formatting and code smells before requesting a review (`pnpm format`).
