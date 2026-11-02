import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowRight,
  BookOpen,
  Calculator,
  Calendar,
  Check,
  CheckCircle2,
  MessageSquare,
  Package,
  Quote,
  ReceiptText,
  ShieldCheck,
  Terminal,
  User,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuthStore, type AuthTenant, type AuthUser } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

export function LandingPage(): React.ReactElement {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const accessToken = useAuthStore((s) => s.accessToken);
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
    <div id="top" className="min-h-screen bg-[#FAF7F2] text-[#1C1917] flex flex-col font-sans">
      {/* 1. Header */}
      <header className="sticky top-0 z-40 border-b border-[#E7E0D4] bg-[#FAF7F2]">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-6 px-6 py-3.5">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-[#1C1917] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14532D] rounded-sm"
          >
            <img
              src="/icon.svg"
              alt="DokanOS Logo"
              className="h-7 w-7 rounded-md shrink-0"
              width={28}
              height={28}
            />
            <span className="font-display text-base font-bold tracking-tight">DokanOS</span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-xs font-medium text-[#57534E]"
          >
            <a href="#inventory" className="hover:text-[#1C1917] transition-colors">
              Inventory
            </a>
            <a href="#pos" className="hover:text-[#1C1917] transition-colors">
              POS
            </a>
            <a href="#baki-dues" className="hover:text-[#1C1917] transition-colors">
              Baki Dues
            </a>
            <a href="#billing" className="hover:text-[#1C1917] transition-colors">
              Billing
            </a>
            <a href="#pricing" className="hover:text-[#1C1917] transition-colors">
              Pricing
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/login"
              className="text-xs font-semibold text-[#1C1917] hover:text-[#14532D] transition-colors px-2 py-1.5"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="inline-flex items-center justify-center rounded-md bg-[#14532D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#14532D]/90 transition-colors"
            >
              Start free
            </Link>
            <Link
              to={accessToken ? '/app/dashboard' : '/login'}
              aria-label={accessToken ? 'Open shop dashboard' : 'Sign in to account'}
              className="h-8 w-8 rounded-full bg-[#14532D] text-white flex items-center justify-center hover:bg-[#14532D]/90 transition-colors shrink-0"
            >
              <User className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* 2. Hero */}
        <section className="max-w-4xl mx-auto text-center pt-14 pb-10 px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E7E0D4] bg-white px-3.5 py-1 text-[10px] font-mono uppercase tracking-wider font-semibold text-[#1C1917]">
            <span className="h-2 w-2 rounded-full bg-[#14532D]" aria-hidden="true" />
            <span>BUILT FOR BANGLADESHI RETAIL &amp; PHARMACIES</span>
          </div>

          <h1
            className="font-display text-4xl sm:text-5xl md:text-[52px] font-bold tracking-tight text-[#1C1917] leading-[1.08] mt-5"
            style={{ textWrap: 'balance' }}
          >
            The operating system for your shop
          </h1>

          <p className="text-sm sm:text-base text-[#57534E] leading-relaxed max-w-2xl mx-auto mt-4">
            Inventory, sales, dues and billing for pharmacies, groceries and electronics shops
            across Bangladesh — in one clean ledger.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
            <Link
              to="/register"
              className="inline-flex items-center justify-center rounded-md bg-[#14532D] px-6 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-[#14532D]/90 transition-colors"
            >
              Start free
            </Link>
            <button
              type="button"
              onClick={() => {
                void handleTryDemoShop();
              }}
              disabled={loadingDemo}
              className="inline-flex items-center justify-center rounded-md border border-[#E7E0D4] bg-white px-6 py-2.5 text-xs sm:text-sm font-semibold text-[#1C1917] hover:bg-[#F3EFE6] transition-colors cursor-pointer disabled:opacity-60"
            >
              {loadingDemo ? 'Opening Demo Shop...' : 'Try the demo shop'}
            </button>
          </div>

          <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-[#57534E]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
            <span>Trusted by 2,400+ shops in Dhaka, Chattogram and Khulna</span>
          </div>
        </section>

        {/* 3. Live Ledger Preview Card (Demo Shop Snapshot) */}
        <section aria-label="Live Ledger preview" className="max-w-4xl mx-auto px-6 pb-16">
          <div className="rounded-xl border border-[#E7E0D4] bg-white shadow-xs overflow-hidden">
            {/* Top Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 bg-[#FAF7F2]/60 border-b border-[#E7E0D4]">
              <div className="flex items-start gap-2.5">
                <span
                  className="h-2.5 w-2.5 rounded-full bg-[#14532D] mt-1.5 shrink-0"
                  aria-hidden="true"
                />
                <div>
                  <div className="font-display text-sm font-bold text-[#1C1917]">
                    Rahim Pharmacy — Live Ledger
                  </div>
                  <div className="text-[11px] text-[#57534E]">
                    Counter 01 · Mirpur-10, Dhaka · Active Session
                  </div>
                </div>
              </div>

              <div className="inline-flex items-center gap-1.5 rounded-md border border-[#E7E0D4] bg-white px-2.5 py-1 text-[11px] font-medium text-[#57534E] self-start sm:self-auto">
                <Calendar className="h-3 w-3 text-[#57534E]" />
                <span className="tabular-nums">Today, 24 Oct</span>
              </div>
            </div>

            {/* 3 KPI Boxes */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-white border-b border-[#E7E0D4]">
              <div className="rounded-lg border border-[#E7E0D4] bg-[#FAF7F2]/40 p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#57534E]">
                  TODAY&apos;S REVENUE
                </div>
                <div className="font-display text-2xl font-bold text-[#14532D] tabular-nums mt-1">
                  ৳18,450
                </div>
                <div className="text-[11px] text-[#57534E] mt-1 tabular-nums">
                  42 completed sales today
                </div>
              </div>

              <div className="rounded-lg border border-[#E7E0D4] bg-[#FAF7F2]/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#57534E]">
                    ACTIVE BAKI DUES
                  </span>
                  <span className="rounded bg-[#FEF3C7] border border-[#FDE68A] px-1.5 py-0.5 text-[10px] font-mono font-semibold text-[#B45309] tabular-nums">
                    12 accounts
                  </span>
                </div>
                <div className="font-display text-2xl font-bold text-[#1C1917] tabular-nums mt-1">
                  ৳6,230
                </div>
                <div className="text-[11px] text-[#57534E] mt-1 tabular-nums">
                  Aging: ৳1,400 past 30 days
                </div>
              </div>

              <div className="rounded-lg border border-[#E7E0D4] bg-[#FAF7F2]/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#57534E]">
                    STOCK ALERT
                  </span>
                  <span className="rounded bg-[#FEE2E2] border border-[#FECACA] px-1.5 py-0.5 text-[10px] font-mono font-semibold text-[#B91C1C]">
                    Low Stock
                  </span>
                </div>
                <div className="font-display text-base font-bold text-[#B91C1C] tabular-nums mt-2">
                  Seclo 20 — 4 left
                </div>
                <div className="text-[11px] text-[#57534E] mt-1.5 tabular-nums">
                  Suggested reorder: 50 strips
                </div>
              </div>
            </div>

            {/* Ledger Rows */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#FAF7F2] border-b border-[#E7E0D4] text-[10px] font-mono uppercase tracking-wider text-[#57534E]">
                    <th className="py-2.5 pl-6 pr-3 font-medium">TIME</th>
                    <th className="py-2.5 px-3 font-medium">ITEM &amp; PARTICULARS</th>
                    <th className="py-2.5 px-3 font-medium">TYPE</th>
                    <th className="py-2.5 pl-3 pr-6 text-right font-medium">AMOUNT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E0D4] text-xs">
                  <tr>
                    <td className="py-3.5 pl-6 pr-3 font-mono text-[11px] text-[#57534E] tabular-nums whitespace-nowrap">
                      10:42 AM
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="font-semibold text-[#1C1917]">
                        Napa Extra 500mg (Strip of 10) + Histacin
                      </div>
                      <div className="text-[11px] text-[#57534E]">
                        Receipt #INV-8891 · Over the counter
                      </div>
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="inline-block rounded bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-mono font-semibold text-[#14532D]">
                        Cash
                      </span>
                    </td>
                    <td className="py-3.5 pl-3 pr-6 text-right font-mono font-semibold text-[#1C1917] tabular-nums whitespace-nowrap">
                      ৳120
                    </td>
                  </tr>

                  <tr>
                    <td className="py-3.5 pl-6 pr-3 font-mono text-[11px] text-[#57534E] tabular-nums whitespace-nowrap">
                      10:35 AM
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="font-semibold text-[#1C1917]">
                        Seclo 20mg Capsule (Box of 30)
                      </div>
                      <div className="text-[11px] text-[#57534E]">
                        Receipt #INV-8890 · Scan via barcode
                      </div>
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="inline-block rounded border border-[#E7E0D4] bg-[#F3EFE6] px-2 py-0.5 text-[10px] font-mono font-semibold text-[#1C1917]">
                        bKash QR
                      </span>
                    </td>
                    <td className="py-3.5 pl-3 pr-6 text-right font-mono font-semibold text-[#1C1917] tabular-nums whitespace-nowrap">
                      ৳210
                    </td>
                  </tr>

                  <tr>
                    <td className="py-3.5 pl-6 pr-3 font-mono text-[11px] text-[#57534E] tabular-nums whitespace-nowrap">
                      10:18 AM
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="font-semibold text-[#1C1917]">
                        Customer: Belal Hossain — Baki Payment
                      </div>
                      <div className="text-[11px] text-[#57534E]">
                        Ledger Khata Page #14 · Partial clearance
                      </div>
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="inline-block rounded bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-mono font-semibold text-[#14532D]">
                        bKash
                      </span>
                    </td>
                    <td className="py-3.5 pl-3 pr-6 text-right font-mono font-semibold text-[#14532D] tabular-nums whitespace-nowrap">
                      ৳1,500
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Footer Bar */}
            <div className="px-6 py-3 bg-[#FAF7F2] border-t border-[#E7E0D4] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[#57534E]">
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                <span>Ledger synchronized with DokanOS cloud (Dhaka Server)</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleTryDemoShop();
                }}
                disabled={loadingDemo}
                className="inline-flex items-center gap-1 font-semibold text-[#1C1917] hover:text-[#14532D] transition-colors cursor-pointer self-start sm:self-auto"
              >
                <span>Open Full Ledger</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </section>

        {/* 4. Modules (MODULE 01-04) */}
        <section className="border-t border-[#E7E0D4]">
          <div className="max-w-5xl mx-auto px-6 py-16 space-y-8">
            <div className="space-y-1.5 max-w-2xl">
              <div className="text-[10px] font-mono uppercase tracking-wider font-semibold text-[#14532D]">
                ENGINEERED FOR PHYSICAL COUNTERS
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1C1917]">
                High-density utility without the clutter
              </h2>
              <p className="text-xs sm:text-sm text-[#57534E]">
                Replace physical binders and disjointed apps with four purpose-built ledger modules
                crafted for daily retail pressure.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* MODULE 01: Inventory */}
              <article
                id="inventory"
                className="rounded-xl border border-[#E7E0D4] bg-white p-6 flex flex-col justify-between gap-6"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#E7E0D4] pb-3">
                    <div className="flex items-center gap-2 font-display text-base font-bold text-[#1C1917]">
                      <Package className="h-4 w-4 text-[#14532D]" />
                      <span>Inventory</span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#57534E]">
                      MODULE 01
                    </span>
                  </div>

                  <h3 className="font-display text-sm font-bold text-[#1C1917] pt-1">
                    Track every SKU, batch and expiry
                  </h3>
                  <p className="text-xs text-[#57534E] leading-relaxed">
                    Real-time stock alerts before you run out of fast-movers. Batch tracking and
                    expiry date monitoring built specifically for medicine and packaged goods.
                  </p>
                </div>

                <div className="rounded-lg border border-[#E7E0D4] bg-[#FAF7F2] p-3.5 text-xs">
                  <div className="grid grid-cols-12 text-[10px] font-mono text-[#57534E] border-b border-[#E7E0D4] pb-1.5 mb-2">
                    <span className="col-span-5">SKU / Drug Particular</span>
                    <span className="col-span-4">Batch &amp; Expiry</span>
                    <span className="col-span-3 text-right">Balance</span>
                  </div>
                  <div className="grid grid-cols-12 items-center">
                    <div className="col-span-5">
                      <div className="font-semibold text-[#1C1917]">Paracetamol 500mg</div>
                      <div className="text-[10px] text-[#57534E]">Beximco Pharma</div>
                    </div>
                    <div className="col-span-4 font-mono text-[11px]">
                      <div className="text-[#1C1917]">Batch #B-402</div>
                      <div className="text-[10px] text-[#57534E]">Exp: 11/2026</div>
                    </div>
                    <div className="col-span-3 text-right">
                      <div className="font-mono font-semibold text-[#14532D] tabular-nums">
                        140 strips
                      </div>
                      <div className="text-[10px] text-[#57534E]">Shelf A-3</div>
                    </div>
                  </div>
                </div>
              </article>

              {/* MODULE 02: POS */}
              <article
                id="pos"
                className="rounded-xl border border-[#E7E0D4] bg-white p-6 flex flex-col justify-between gap-6"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#E7E0D4] pb-3">
                    <div className="flex items-center gap-2 font-display text-base font-bold text-[#1C1917]">
                      <Calculator className="h-4 w-4 text-[#14532D]" />
                      <span>POS</span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#57534E]">
                      MODULE 02
                    </span>
                  </div>

                  <h3 className="font-display text-sm font-bold text-[#1C1917] pt-1">
                    Fast counter sales with Cash, bKash and Card
                  </h3>
                  <p className="text-xs text-[#57534E] leading-relaxed">
                    Lightning-fast barcode scanning or quick-search keyboard shortcuts. Accept
                    physical cash, generate instant bKash dynamic merchant QR, or card payments.
                  </p>
                </div>

                <div className="rounded-lg border border-[#E7E0D4] bg-[#FAF7F2] p-3.5 text-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#57534E]">Active Counter Total</span>
                    <span className="font-display text-sm font-bold text-[#1C1917] tabular-nums">
                      Total: ৳450
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-[#E7E0D4] bg-white px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] text-[#57534E]">Cash Tendered</span>
                      <span className="font-mono text-xs font-semibold text-[#1C1917] tabular-nums">
                        ৳200
                      </span>
                    </div>
                    <div className="rounded border border-[#E7E0D4] bg-white px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] text-[#57534E]">bKash Merchant</span>
                      <span className="font-mono text-xs font-semibold text-[#14532D] tabular-nums">
                        ৳250
                      </span>
                    </div>
                  </div>
                </div>
              </article>

              {/* MODULE 03: Baki Dues */}
              <article
                id="baki-dues"
                className="rounded-xl border border-[#E7E0D4] bg-white p-6 flex flex-col justify-between gap-6"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#E7E0D4] pb-3">
                    <div className="flex items-center gap-2 font-display text-base font-bold text-[#1C1917]">
                      <BookOpen className="h-4 w-4 text-[#14532D]" />
                      <span>Baki Dues</span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#57534E]">
                      MODULE 03
                    </span>
                  </div>

                  <h3 className="font-display text-sm font-bold text-[#1C1917] pt-1">
                    Customer and supplier credit ledger with ageing
                  </h3>
                  <p className="text-xs text-[#57534E] leading-relaxed">
                    Digitize your traditional Khatiyan. Automatic SMS balance reminders, ageing
                    reports (0–30, 30–60, 60+ days), and clear payment history per customer.
                  </p>
                </div>

                <div className="rounded-lg border border-[#E7E0D4] bg-[#FAF7F2] p-3.5 text-xs flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[#1C1917]">Kabir Mia</div>
                    <div className="text-[11px] text-[#57534E] tabular-nums">
                      Last paid: 3 days ago · Due:{' '}
                      <span className="font-mono font-semibold text-[#B45309]">৳1,400</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleTryDemoShop();
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-[#E7E0D4] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#1C1917] hover:bg-[#F3EFE6] transition-colors shrink-0 cursor-pointer"
                  >
                    <MessageSquare className="h-3 w-3 text-[#57534E]" />
                    <span>Send SMS Reminder</span>
                  </button>
                </div>
              </article>

              {/* MODULE 04: Billing */}
              <article
                id="billing"
                className="rounded-xl border border-[#E7E0D4] bg-white p-6 flex flex-col justify-between gap-6"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#E7E0D4] pb-3">
                    <div className="flex items-center gap-2 font-display text-base font-bold text-[#1C1917]">
                      <ReceiptText className="h-4 w-4 text-[#14532D]" />
                      <span>Billing</span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#57534E]">
                      MODULE 04
                    </span>
                  </div>

                  <h3 className="font-display text-sm font-bold text-[#1C1917] pt-1">
                    Invoices, receipts and daily reports
                  </h3>
                  <p className="text-xs text-[#57534E] leading-relaxed">
                    Print 58mm/80mm thermal receipts or send instant digital WhatsApp receipts.
                    End-of-day Hisab summaries showing gross profit, cash in drawer, and dues
                    collected.
                  </p>
                </div>

                <div className="rounded-lg border border-[#E7E0D4] bg-[#FAF7F2] p-3.5 text-xs space-y-2">
                  <div className="flex items-center justify-between border-b border-[#E7E0D4] pb-1.5">
                    <span className="font-semibold text-[#1C1917]">Day-End Hisab Summary</span>
                    <span className="font-mono text-[11px] font-semibold text-[#14532D]">
                      Reconciled
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#57534E] tabular-nums">
                    <span>
                      Cash drawer match: <strong className="text-[#1C1917]">৳12,800</strong>
                    </span>
                    <span>
                      bKash settlement: <strong className="text-[#1C1917]">৳5,650</strong>
                    </span>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* 5. Setup Steps 01-03 */}
        <section className="bg-[#F3EFE6]/70 border-y border-[#E7E0D4] py-16 px-6">
          <div className="max-w-5xl mx-auto space-y-10">
            <div className="text-center space-y-1.5 max-w-xl mx-auto">
              <div className="text-[10px] font-mono uppercase tracking-wider font-semibold text-[#14532D]">
                ZERO FRICTION SETUP
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1C1917]">
                Start your digital ledger in three minutes
              </h2>
              <p className="text-xs sm:text-sm text-[#57534E]">
                No complicated database setups. No IT degree required. Designed for immediate
                counter readiness.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="rounded-xl border border-[#E7E0D4] bg-white p-6 space-y-2.5">
                <div className="font-display text-base font-bold text-[#14532D]">
                  01 / Create your shop
                </div>
                <div className="text-xs font-bold text-[#1C1917]">
                  Basic details &amp; trade type
                </div>
                <p className="text-xs text-[#57534E] leading-relaxed">
                  Set shop name, address (e.g., Mirpur, Dhaka), and select your category (Pharmacy,
                  Grocery, Electronics) for custom tax &amp; unit templates.
                </p>
              </div>

              <div className="rounded-xl border border-[#E7E0D4] bg-white p-6 space-y-2.5">
                <div className="font-display text-base font-bold text-[#14532D]">
                  02 / Add products
                </div>
                <div className="text-xs font-bold text-[#1C1917]">
                  Instant barcode &amp; DGDA sync
                </div>
                <p className="text-xs text-[#57534E] leading-relaxed">
                  Scan barcodes or import your existing price list in seconds with pre-loaded
                  Bangladesh medicine and grocery databases.
                </p>
              </div>

              <div className="rounded-xl border border-[#E7E0D4] bg-white p-6 space-y-2.5">
                <div className="font-display text-base font-bold text-[#14532D]">
                  03 / Sell and collect dues
                </div>
                <div className="text-xs font-bold text-[#1C1917]">
                  Counter POS &amp; Baki logging
                </div>
                <p className="text-xs text-[#57534E] leading-relaxed">
                  Start billing customers at the counter, log Baki instantly, and collect payments
                  via bKash QR, Nagad or cash without discrepancies.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Pricing */}
        <section id="pricing" className="max-w-5xl mx-auto px-6 py-16 space-y-10">
          <div className="text-center space-y-1.5 max-w-xl mx-auto">
            <div className="text-[10px] font-mono uppercase tracking-wider font-semibold text-[#14532D]">
              PREDICTABLE ACCOUNTING
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1C1917]">
              Simple, transparent pricing for every shop
            </h2>
            <p className="text-xs sm:text-sm text-[#57534E]">
              Start free with zero commitment. Upgrade as your shop grows.
            </p>
          </div>

          <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* Free Plan */}
            <div className="rounded-xl border border-[#E7E0D4] bg-white p-7 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-bold text-[#1C1917]">Free Plan</h3>
                  <span className="rounded border border-[#E7E0D4] bg-[#FAF7F2] px-2.5 py-0.5 text-[11px] font-medium text-[#57534E]">
                    Starter
                  </span>
                </div>

                <div className="flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold text-[#1C1917] tabular-nums">
                    ৳0
                  </span>
                  <span className="text-xs text-[#57534E]">/ forever</span>
                </div>

                <p className="text-xs text-[#57534E] leading-relaxed">
                  Essential bookkeeping and POS for small community corner stores.
                </p>

                <hr className="border-[#E7E0D4]" />

                <ul className="space-y-3 text-xs text-[#1C1917]">
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>1 shop location</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Up to 100 products</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Basic POS counter billing</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Standard receipt printing (58mm)</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Community email support</span>
                  </li>
                </ul>
              </div>

              <div className="pt-6">
                <Link
                  to="/register"
                  className="w-full inline-flex items-center justify-center rounded-md border border-[#E7E0D4] bg-white px-4 py-2.5 text-xs font-semibold text-[#1C1917] hover:bg-[#F3EFE6] transition-colors"
                >
                  Get started free
                </Link>
              </div>
            </div>

            {/* Pro Plan */}
            <div className="rounded-xl border-2 border-[#14532D] bg-white p-7 flex flex-col justify-between relative">
              <div className="absolute -top-3 right-5 rounded bg-[#14532D] px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider font-semibold text-white">
                MOST POPULAR FOR BUSY SHOPS
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-bold text-[#1C1917]">Pro Plan</h3>
                  <span className="rounded bg-[#DCFCE7] px-2.5 py-0.5 text-[11px] font-semibold text-[#14532D]">
                    Full Suite
                  </span>
                </div>

                <div className="flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold text-[#14532D] tabular-nums">
                    ৳499
                  </span>
                  <span className="text-xs text-[#57534E] tabular-nums">
                    / month (or ৳4,200/yr)
                  </span>
                </div>

                <p className="text-xs text-[#57534E] leading-relaxed">
                  Full ledger power with SMS notifications and staff governance for active retail.
                </p>

                <hr className="border-[#E7E0D4]" />

                <ul className="space-y-3 text-xs text-[#1C1917]">
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Unlimited products &amp; SKUs</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Multi-counter &amp; multi-shop support</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Staff role permissions &amp; audit log</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Automated SMS Baki reminders</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Batch &amp; expiry tracking engine</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="h-3.5 w-3.5 text-[#14532D] shrink-0" />
                    <span>Priority WhatsApp &amp; phone support</span>
                  </li>
                </ul>
              </div>

              <div className="pt-6">
                <Link
                  to="/register"
                  className="w-full inline-flex items-center justify-center rounded-md bg-[#14532D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#14532D]/90 transition-colors"
                >
                  Start 14-day free trial
                </Link>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#57534E]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#57534E] shrink-0" />
            <span>
              Pay by card via SSLCommerz. Cancel anytime. No hidden installation fees.
            </span>
          </div>
        </section>

        {/* 7. Testimonial + Final CTA */}
        <section id="testimony" className="bg-[#F3EFE6]/70 border-t border-[#E7E0D4] py-14 px-6">
          <div className="max-w-3xl mx-auto rounded-xl border border-[#E7E0D4] bg-white p-8 space-y-5">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider font-semibold text-[#57534E]">
              <Quote className="h-4 w-4 text-[#14532D]" />
              <span>MERCHANT TESTIMONY</span>
            </div>

            <blockquote className="font-display text-lg sm:text-xl font-bold text-[#1C1917] leading-snug">
              &ldquo;DokanOS cut our stock-outs and made Baki collection easy. We recovered over
              ৳45,000 in overdue customer credit in the first month alone.&rdquo;
            </blockquote>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-[#E7E0D4]">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full border border-[#E7E0D4] bg-[#FAF7F2] flex items-center justify-center font-display text-xs font-bold text-[#14532D] shrink-0">
                  RU
                </div>
                <div>
                  <div className="text-xs font-bold text-[#1C1917]">Rahim Uddin</div>
                  <div className="text-[11px] text-[#57534E]">
                    Proprietor, Rahim Pharmacy — Mirpur-10, Dhaka
                  </div>
                </div>
              </div>

              <div className="inline-flex items-center gap-1.5 rounded bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-semibold text-[#14532D] self-start sm:self-auto">
                <CheckCircle2 className="h-3 w-3 text-[#14532D]" />
                <span>Verified Merchant</span>
              </div>
            </div>
          </div>
        </section>

        <section className="py-14 px-6 border-t border-[#E7E0D4]">
          <div className="max-w-3xl mx-auto rounded-xl border border-[#E7E0D4] bg-white py-10 px-6 text-center space-y-5">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1C1917]">
              Ready to bring order to your shop&rsquo;s ledger?
            </h2>
            <p className="text-xs sm:text-sm text-[#57534E]">
              Join 2,400+ shop owners across Bangladesh today.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <Link
                to="/register"
                className="inline-flex items-center justify-center rounded-md bg-[#14532D] px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#14532D]/90 transition-colors"
              >
                Start free today
              </Link>
              <button
                type="button"
                onClick={() => {
                  void handleTryDemoShop();
                }}
                disabled={loadingDemo}
                className="inline-flex items-center justify-center rounded-md border border-[#E7E0D4] bg-white px-6 py-2.5 text-xs font-semibold text-[#1C1917] hover:bg-[#F3EFE6] transition-colors cursor-pointer disabled:opacity-60"
              >
                {loadingDemo ? 'Opening Demo Shop...' : 'Try the live demo shop'}
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E7E0D4] bg-[#F3EFE6]/50 pt-12 pb-8 px-6 text-xs text-[#57534E]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8 pb-10 border-b border-[#E7E0D4]">
          <div className="md:col-span-5 space-y-3">
            <Link to="/" className="inline-flex items-center gap-2 text-[#1C1917]">
              <img
                src="/icon.svg"
                alt="DokanOS Logo"
                className="h-6 w-6 rounded shrink-0"
                width={24}
                height={24}
              />
              <span className="font-display text-sm font-bold tracking-tight">DokanOS</span>
            </Link>
            <p className="text-xs text-[#57534E] leading-relaxed max-w-xs">
              The operating system for retail and pharmacy shops across Bangladesh. Bridging tactile
              physical khata discipline with high-density automated POS power.
            </p>
            <div className="pt-1">
              <span className="inline-flex items-center gap-1.5 rounded border border-[#E7E0D4] bg-white px-2.5 py-1 text-[10px] font-medium text-[#57534E]">
                <CheckCircle2 className="h-3 w-3 text-[#14532D]" />
                <span>Verified Retail Stack</span>
              </span>
            </div>
          </div>

          <div className="md:col-span-2 space-y-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider font-semibold text-[#1C1917]">
              PRODUCT
            </div>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="#inventory" className="hover:text-[#1C1917] transition-colors">
                  Inventory
                </a>
              </li>
              <li>
                <a href="#pos" className="hover:text-[#1C1917] transition-colors">
                  Point of Sale
                </a>
              </li>
              <li>
                <a href="#baki-dues" className="hover:text-[#1C1917] transition-colors">
                  Baki Ledger
                </a>
              </li>
              <li>
                <a href="#billing" className="hover:text-[#1C1917] transition-colors">
                  Billing &amp; Invoicing
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-[#1C1917] transition-colors">
                  Pricing
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    void handleTryDemoShop();
                  }}
                  className="hover:text-[#1C1917] transition-colors cursor-pointer text-left"
                >
                  Demo Shop
                </button>
              </li>
            </ul>
          </div>

          <div className="md:col-span-2 space-y-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider font-semibold text-[#1C1917]">
              COMPANY
            </div>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="#top" className="hover:text-[#1C1917] transition-colors">
                  About
                </a>
              </li>
              <li>
                <a href="#testimony" className="hover:text-[#1C1917] transition-colors">
                  Customers
                </a>
              </li>
              <li>
                <Link to="/register" className="hover:text-[#1C1917] transition-colors">
                  Careers
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-[#1C1917] transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-3 space-y-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider font-semibold text-[#1C1917]">
              SUPPORT
            </div>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/login" className="hover:text-[#1C1917] transition-colors">
                  Help Center
                </Link>
              </li>
              <li>
                <a href="#billing" className="hover:text-[#1C1917] transition-colors">
                  bKash Setup Guide
                </a>
              </li>
              <li>
                <a href="#pos" className="hover:text-[#1C1917] transition-colors">
                  Hardware Compatibility
                </a>
              </li>
              <li>
                <a href="#inventory" className="hover:text-[#1C1917] transition-colors">
                  Security
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-5xl mx-auto pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-[#57534E]">
          <span>Mirpur, Dhaka, Bangladesh</span>
          <span>&copy; 2026 DokanOS Inc. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
