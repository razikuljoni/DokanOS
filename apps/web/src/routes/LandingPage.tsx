import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Check, ShieldCheck, Store } from 'lucide-react';
import { PLAN_LIMITS, PRO_PRICE_BDT } from '@dokanos/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { apiFetch } from '@/lib/api';
import { useAuthStore, type AuthTenant, type AuthUser } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { formatBDT } from '@/lib/utils';

export function LandingPage(): React.ReactElement {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const addToast = useUiStore((s) => s.addToast);
  const [loadingDemo, setLoadingDemo] = useState(false);

  const handleTryDemoShop = async (): Promise<void> => {
    setLoadingDemo(true);
    try {
      const res = await apiFetch<{
        accessToken: string;
        user: AuthUser;
        tenant: AuthTenant;
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'demo@dokan-os.demo',
          password: 'Demo1234!',
        }),
      });
      setAuth(res);
      addToast({
        title: 'Welcome to Rahim Pharmacy (Demo)',
        description: 'Logged in as shop owner on DokanOS Pro.',
        variant: 'success',
      });
      void navigate('/app/dashboard');
    } catch (err) {
      addToast({
        title: 'Demo login failed',
        description: err instanceof Error ? err.message : 'Please try again',
        variant: 'danger',
      });
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-border bg-card">
        <Link
          to="/"
          className="font-display text-xl font-bold tracking-tight text-foreground whitespace-nowrap shrink-0"
        >
          DokanOS
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
          <a
            href="#capabilities"
            className="hover:text-foreground transition-colors whitespace-nowrap shrink-0"
          >
            Capabilities
          </a>
          <a
            href="#ledger-proof"
            className="hover:text-foreground transition-colors whitespace-nowrap shrink-0"
          >
            Architecture
          </a>
          <a
            href="#pricing"
            className="hover:text-foreground transition-colors whitespace-nowrap shrink-0"
          >
            Pricing
          </a>
          <Link
            to="/login"
            className="hover:text-foreground transition-colors whitespace-nowrap shrink-0"
          >
            Sign In
          </Link>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <Button
            size="sm"
            onClick={() => {
              void handleTryDemoShop();
            }}
            disabled={loadingDemo}
          >
            {loadingDemo ? 'Opening Demo Shop...' : 'Try the demo shop'}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-14 space-y-20">
        {/* Hero Split */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                <span>Built for Bangladeshi Pharmacies, Groceries & Electronics Shops</span>
                <span aria-hidden="true"> · </span>
                <span>Dhaka, Bangladesh</span>
              </div>

              <h1
                className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-foreground leading-[1.1]"
                style={{ textWrap: 'balance' }}
              >
                Replace paper khata ledgers with atomic POS sales and Baki tracking.
              </h1>

              <p className="text-base text-muted-foreground leading-relaxed max-w-xl">
                DokanOS keeps every medicine strip, supplier restock, cash or bKash counter bill,
                and customer credit balance accurate to the last Taka—isolated per shop tenant.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  onClick={() => {
                    void handleTryDemoShop();
                  }}
                  disabled={loadingDemo}
                >
                  {loadingDemo ? 'Signing in to Rahim Pharmacy...' : 'Try the demo shop'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Link to="/register">
                  <Button variant="outline" size="lg">
                    Register Your Shop Free
                  </Button>
                </Link>
              </div>

              {/* Mandatory §11 free-tier wake-up note */}
              <p className="text-xs text-muted-foreground">
                First load may take up to a minute — the free server wakes up.
              </p>
            </div>
          </div>

          {/* Right Column: Live Ledger Preview Specimen */}
          <div className="lg:col-span-5">
            <Card className="h-full flex flex-col justify-between p-6 bg-card">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <div className="font-display text-base font-semibold">
                      Rahim Pharmacy · Mirpur-10
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Daily Counter & Baki Snapshot
                    </div>
                  </div>
                  <Store className="h-5 w-5 text-primary" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-md bg-secondary/60 border border-border">
                    <div className="text-xs text-muted-foreground">30-Day Revenue</div>
                    <div className="font-display text-xl font-bold tabular-nums text-foreground mt-1">
                      ৳68,420
                    </div>
                  </div>
                  <div className="p-3.5 rounded-md bg-secondary/60 border border-border">
                    <div className="text-xs text-muted-foreground">Net COGS Profit</div>
                    <div className="font-display text-xl font-bold tabular-nums text-primary mt-1">
                      ৳14,890
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between py-1.5 border-b border-border">
                    <span>Napa Extra 500mg (Box)</span>
                    <span className="font-mono tabular-nums text-warning font-medium">
                      4 box left · Reorder
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-border">
                    <span>Accu-Chek Glucometer Strips</span>
                    <span className="font-mono tabular-nums text-warning font-medium">
                      2 box left · Reorder
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span>Square Pharma Payable (Baki)</span>
                    <span className="font-mono tabular-nums text-foreground font-medium">
                      ৳18,500 due
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-border mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>Demo Credentials: demo@dokan-os.demo</span>
                <span className="font-mono tabular-nums">Pass: Demo1234!</span>
              </div>
            </Card>
          </div>
        </section>

        <Separator />

        {/* Capabilities with Clean Human Editorial Numbering */}
        <section id="capabilities" className="space-y-8">
          <div className="space-y-2 max-w-2xl">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
              Built for the real workflows of a Bangladeshi retail counter
            </h2>
            <p className="text-sm text-muted-foreground">
              Every module is tenant-isolated and backed by MongoDB replica-set transactions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>01. Atomic POS Sales & Zero Negative Stock</CardTitle>
                <CardDescription>
                  Multi-item checkout decrements stock with a conditional <code>$gte</code> guard
                  inside a MongoDB transaction. Even if two staff sell the last unit at the same
                  millisecond, stock never drops below zero.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>02. Unified Baki (Credit) & Ageing Ledger</CardTitle>
                <CardDescription>
                  Track customer receivables from credit sales alongside supplier payables from
                  purchase orders, automatically grouped into 0–7, 8–30, and 30+ day ageing
                  buckets.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>03. Role-Based Access Control (Owner, Manager, Staff)</CardTitle>
                <CardDescription>
                  Counter staff can ring up POS sales and look up stock without seeing supplier
                  margins, shop settings, or billing controls.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>04. Realtime Alerts & SSLCommerz Sandbox Billing</CardTitle>
                <CardDescription>
                  Socket.io pushes instant sale and low-stock notifications to the owner’s
                  dashboard. Upgrade to Pro via SSLCommerz Sandbox or Stripe Test Mode with
                  idempotent webhook verification.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </section>

        {/* Proof Metrics Adjacent to Capabilities */}
        <section
          id="ledger-proof"
          className="rounded-md border border-border bg-card p-6 grid grid-cols-1 sm:grid-cols-4 gap-6"
        >
          <div>
            <div className="font-display text-2xl font-bold tabular-nums text-foreground">
              100% Tenant-Scoped
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Every Mongoose query & aggregation pipeline filters by <code>tenantId</code> first.
            </div>
          </div>
          <div>
            <div className="font-display text-2xl font-bold tabular-nums text-primary">
              15m JWT + SHA-256 RT
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              In-memory access tokens + rotating refresh cookies with family reuse detection.
            </div>
          </div>
          <div>
            <div className="font-display text-2xl font-bold tabular-nums text-foreground">
              60s Cache-Aside
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Dashboard aggregations cached in Redis and invalidated on stock or sale mutations.
            </div>
          </div>
          <div>
            <div className="font-display text-2xl font-bold tabular-nums text-foreground">
              ৳0 Free-Tier Stack
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Runs on Vercel Hobby, Render Free, MongoDB Atlas M0, and Upstash Redis Free.
            </div>
          </div>
        </section>

        {/* Pricing Section: Free vs Pro ৳499/mo */}
        <section id="pricing" className="space-y-8">
          <div className="space-y-2 max-w-xl">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
              Simple, transparent BDT pricing
            </h2>
            <p className="text-sm text-muted-foreground">
              Start free forever for a neighbourhood shop, or unlock Pro limits for growing stores.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
            <Card className="flex flex-col justify-between">
              <CardHeader>
                <div className="text-xs font-medium text-muted-foreground">
                  For neighbourhood single-counter shops
                </div>
                <CardTitle className="text-2xl mt-1">Free Plan</CardTitle>
                <div className="font-display text-3xl font-bold tabular-nums pt-2">
                  ৳0 <span className="text-sm font-normal text-muted-foreground">/ forever</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span className="tabular-nums">
                      Up to {PLAN_LIMITS.free.maxProducts} active products
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span className="tabular-nums">
                      Owner + {PLAN_LIMITS.free.maxStaff} staff account
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span>Atomic POS sales, purchases & Baki ledger</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span>In-app low-stock & due alerts</span>
                  </li>
                </ul>
                <Link to="/register" className="block pt-2">
                  <Button variant="outline" className="w-full">
                    Create Free Shop Account
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="border-primary flex flex-col justify-between">
              <CardHeader>
                <div className="text-xs font-medium text-primary">
                  For busy pharmacies & multi-staff stores
                </div>
                <CardTitle className="text-2xl mt-1">Pro Plan</CardTitle>
                <div className="font-display text-3xl font-bold tabular-nums pt-2">
                  {formatBDT(PRO_PRICE_BDT)}{' '}
                  <span className="text-sm font-normal text-muted-foreground">/ 30 days</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span>Unlimited products & stock movement ledger</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span className="tabular-nums">
                      Owner + up to {PLAN_LIMITS.pro.maxStaff} staff/manager accounts
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span>Bulk CSV product import & CSV ledger export</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span>Automated daily low-stock & weekly email digests</span>
                  </li>
                </ul>
                <div className="pt-2">
                  <Button
                    className="w-full"
                    onClick={() => {
                      void handleTryDemoShop();
                    }}
                    disabled={loadingDemo}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Explore Pro in Demo Shop
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card px-6 py-6 text-xs text-muted-foreground">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span>DokanOS — Modern Ledger & POS for Bangladeshi Retail Shops</span>
          <div className="flex items-center gap-4">
            <Link to="/login" className="hover:text-foreground">
              Sign In
            </Link>
            <Link to="/register" className="hover:text-foreground">
              Register Shop
            </Link>
            <span className="font-mono tabular-nums">BDT (৳) · Asia/Dhaka</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
