import React from 'react';
import { Link } from 'react-router';
import { ArrowLeft, BookOpen, Building2, FileText, ShieldCheck } from 'lucide-react';

interface InfoLayoutProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function InfoLayout({ title, subtitle, icon, children }: InfoLayoutProps): React.ReactElement {
  return (
    <div className="min-h-screen bg-[#FAF8F4] text-[#1C1917] flex flex-col">
      <header className="border-b border-[#E7E0D4] bg-white/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
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
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#57534E] hover:text-[#1C1917]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Home
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div className="space-y-2 border-b border-[#E7E0D4] pb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E7E0D4] bg-white px-3 py-1 text-[11px] font-medium text-[#14532D]">
            {icon}
            <span>DokanOS Documentation</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-[#57534E]">{subtitle}</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-[#44403C]">{children}</div>
      </main>

      <footer className="border-t border-[#E7E0D4] bg-[#F3EFE6]/50 py-6 px-4 sm:px-6 text-xs text-[#57534E]">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>&copy; 2026 DokanOS Inc. · Mirpur, Dhaka, Bangladesh</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/about" className="hover:text-[#1C1917]">
              About
            </Link>
            <Link to="/help" className="hover:text-[#1C1917]">
              Help Center
            </Link>
            <Link to="/privacy" className="hover:text-[#1C1917]">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-[#1C1917]">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function AboutPage(): React.ReactElement {
  return (
    <InfoLayout
      title="About DokanOS"
      subtitle="Retail, pharmacy, and Baki ledger infrastructure built for Bangladesh."
      icon={<Building2 className="h-3.5 w-3.5" />}
    >
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-[#1C1917]">Our Mission</h2>
        <p>
          DokanOS helps independent pharmacies, grocery stores, electronics shops, and retail
          outlets across Bangladesh replace fragile paper khatas with an atomic, offline-capable
          point-of-sale and inventory system.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-[#1C1917]">Core Architecture</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Multi-tenant isolation across every product, sale, purchase, and customer ledger.</li>
          <li>ACID MongoDB transactions for POS checkout, partial returns, and Baki settlements.</li>
          <li>Offline-first IndexedDB outbox with idempotency keys for unstable connections.</li>
          <li>58mm and 80mm thermal receipt printing for counter printers.</li>
        </ul>
      </section>
    </InfoLayout>
  );
}

export function HelpCenterPage(): React.ReactElement {
  return (
    <InfoLayout
      title="Help Center"
      subtitle="Quick guides for POS, Baki dues, stock receiving, and billing."
      icon={<BookOpen className="h-3.5 w-3.5" />}
    >
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-[#1C1917]">
          1. Receiving Supplier Stock
        </h2>
        <p>
          Go to <strong>Purchases</strong>, select the supplier and product, enter the received
          quantity and unit cost, and submit. Stock increases immediately and any unpaid balance is
          added to Supplier Payables.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-[#1C1917]">
          2. Recording Baki &amp; Settlements
        </h2>
        <p>
          During POS checkout, select <strong>Baki (Credit)</strong> or enter a partial payment
          with the customer&apos;s name and phone. Collect repayments later from the{' '}
          <strong>Dues / Baki</strong> ledger.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-[#1C1917]">
          3. Thermal Receipt Printing
        </h2>
        <p>
          Choose <strong>58mm</strong> or <strong>80mm</strong> paper width in the POS or Sales
          receipt view and click <strong>Print Thermal Receipt</strong>.
        </p>
      </section>
    </InfoLayout>
  );
}

export function PrivacyPolicyPage(): React.ReactElement {
  return (
    <InfoLayout
      title="Privacy Policy"
      subtitle="How DokanOS stores and protects your shop and customer data."
      icon={<ShieldCheck className="h-3.5 w-3.5" />}
    >
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-[#1C1917]">Tenant Data Isolation</h2>
        <p>
          Every shop operates in an isolated tenant scope. Inventory, invoices, supplier payables,
          and customer Baki records are strictly partitioned by tenant ID at both the API and
          database query layers.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-[#1C1917]">
          Authentication &amp; Tokens
        </h2>
        <p>
          Access tokens are kept in memory only, and refresh tokens are stored as SHA-256 hashes in
          MongoDB with automatic rotation and reuse detection. Passwords are hashed with bcrypt.
        </p>
      </section>
    </InfoLayout>
  );
}

export function TermsPage(): React.ReactElement {
  return (
    <InfoLayout
      title="Terms of Service"
      subtitle="Terms governing use of the DokanOS platform."
      icon={<FileText className="h-3.5 w-3.5" />}
    >
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-[#1C1917]">Account Responsibility</h2>
        <p>
          Shop owners are responsible for managing staff roles, verifying account email addresses,
          and maintaining accurate product, tax, and regulatory records for their business.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-[#1C1917]">
          Subscriptions &amp; Billing
        </h2>
        <p>
          DokanOS Pro subscriptions are billed on a one-off monthly (30-day) or annual (365-day)
          basis via verified payment callbacks. Cancelled checkouts incur no charge.
        </p>
      </section>
    </InfoLayout>
  );
}
