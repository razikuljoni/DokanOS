import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CreditCard,
  ShieldCheck,
  X,
} from 'lucide-react';
import { PRO_PRICE_BDT } from '@dokanos/shared';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, EmptyState, PlanBadge, type DataTableColumn } from '@/components/SharedWidgets';
import { formatBDT, formatDateDhaka } from '@/lib/utils';

// /app/alerts — Notifications Feed
interface NotificationItem {
  _id: string;
  type: 'low_stock' | 'due_reminder' | 'payment' | 'subscription';
  title: string;
  body: string;
  link: string;
  isRead: boolean;
  createdAt: string;
}

export function AlertsPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', tenant?.id, 'list'],
    queryFn: () => apiFetch<{ data: NotificationItem[] }>('/api/v1/notifications?limit=50'),
    enabled: Boolean(tenant?.id),
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', tenant?.id] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/v1/notifications/read-all', { method: 'PATCH' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', tenant?.id] });
      addToast({ title: 'All alerts marked as read', variant: 'success' });
    },
  });

  const items = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Alerts & Notifications Feed
          </h1>
          <p className="text-xs text-muted-foreground">
            Real-time low-stock triggers, Baki due reminders, and subscription updates.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={markAllReadMutation.isPending || items.every((i) => i.isRead)}
          onClick={() => markAllReadMutation.mutate()}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Mark All Read
        </Button>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading alerts...</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No alerts right now — nice."
          description="Low-stock thresholds and Baki reminders will appear here automatically."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card
              key={item._id}
              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                item.isRead ? 'opacity-75' : 'border-primary/50'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Bell className="h-3.5 w-3.5 text-primary" />
                  <span className="uppercase font-mono">{item.type.replace('_', ' ')}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{formatDateDhaka(item.createdAt)}</span>
                  {!item.isRead && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-primary font-semibold">UNREAD</span>
                    </>
                  )}
                </div>
                <h3 className="font-display text-sm font-semibold text-foreground">
                  {item.title}
                </h3>
                <p className="text-xs text-muted-foreground">{item.body}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Link to={item.link}>
                  <Button variant="outline" size="sm">
                    Open Ledger
                  </Button>
                </Link>
                {!item.isRead && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markReadMutation.mutate(item._id)}
                  >
                    Mark Read
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// /app/billing — Billing & Subscription Portal (SSLCommerz Sandbox Primary + Stripe Test Mode Secondary)
interface BillingPlanResponse {
  plan: 'free' | 'pro';
  priceBdt: number;
  planExpiresAt: string | null;
  limits: {
    maxProducts: number | null;
    maxStaff: number;
    csvImportExport: boolean;
    emailDigests: boolean;
  };
  usage: {
    productCount: number;
    staffCount: number;
  };
  payments: Array<{
    _id: string;
    provider: string;
    providerRef: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
  }>;
}

export function BillingPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const updateTenant = useAuthStore((s) => s.updateTenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sandboxModal, setSandboxModal] = useState<{
    provider: 'sslcommerz' | 'stripe';
    tranId: string;
    amount: number;
  } | null>(() => {
    const checkout = searchParams.get('sandbox_checkout');
    const tranId = searchParams.get('tran_id');
    if ((checkout === 'sslcommerz' || checkout === 'stripe') && tranId) {
      return {
        provider: checkout,
        tranId,
        amount: Number(searchParams.get('amount') ?? PRO_PRICE_BDT),
      };
    }
    return null;
  });

  const [cardNumber, setCardNumber] = useState('4111111111111111');
  const [otp, setOtp] = useState('123456');

  const { data, isLoading } = useQuery({
    queryKey: ['billing', tenant?.id],
    queryFn: () => apiFetch<{ data: BillingPlanResponse }>('/api/v1/billing/plan'),
    enabled: Boolean(tenant?.id),
  });

  const initSslCommerzMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{
        data: { GatewayPageURL: string; tranId: string; amount: number };
      }>('/api/v1/billing/sslcommerz/init', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    onSuccess: (res) => {
      setCardNumber('4111111111111111');
      setSandboxModal({
        provider: 'sslcommerz',
        tranId: res.data.tranId,
        amount: res.data.amount,
      });
    },
  });

  const initStripeTestMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{
        data: { checkoutUrl: string; tranId: string; amount: number };
      }>('/api/v1/billing/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    onSuccess: (res) => {
      setCardNumber('4242424242424242');
      setSandboxModal({
        provider: 'stripe',
        tranId: res.data.tranId,
        amount: res.data.amount,
      });
    },
  });

  const completeSandboxPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!sandboxModal) return;
      if (sandboxModal.provider === 'sslcommerz') {
        return apiFetch('/api/v1/billing/sslcommerz/ipn', {
          method: 'POST',
          body: JSON.stringify({
            tran_id: sandboxModal.tranId,
            val_id: `VAL-${Date.now()}`,
            amount: sandboxModal.amount,
            currency: 'BDT',
            status: 'VALID',
            card_no: cardNumber,
          }),
        });
      }
      return apiFetch('/api/v1/billing/stripe/webhook', {
        method: 'POST',
        body: JSON.stringify({
          id: `evt_${Date.now()}`,
          type: 'checkout.session.completed',
          tran_id: sandboxModal.tranId,
        }),
      });
    },
    onSuccess: () => {
      setSandboxModal(null);
      setSearchParams({});
      updateTenant({ plan: 'pro' });
      void queryClient.invalidateQueries({ queryKey: ['billing', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['notifications', tenant?.id] });
      addToast({
        title: 'Upgraded to DokanOS Pro!',
        description: 'Payment validated server-side and Pro limits unlocked for 30 days.',
        variant: 'success',
      });
    },
    onError: (err) => {
      addToast({
        title: 'Payment Validation Failed',
        description: err instanceof Error ? err.message : 'Could not validate payment',
        variant: 'danger',
      });
    },
  });

  const bkashStubMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/v1/billing/bkash/init', { method: 'POST' });
    },
    onError: (err) => {
      addToast({
        title: 'bKash Tokenized Stub (501 NOT_CONFIGURED)',
        description: err instanceof Error ? err.message : 'bKash stub invoked',
        variant: 'warning',
      });
    },
  });

  const billing = data?.data;

  const paymentColumns: DataTableColumn<BillingPlanResponse['payments'][number]>[] = [
    {
      key: 'ref',
      header: 'Transaction ID',
      render: (row) => <span className="font-mono text-xs font-medium">{row.providerRef}</span>,
    },
    {
      key: 'provider',
      header: 'Gateway',
      render: (row) => (
        <span className="text-xs uppercase font-medium">
          {row.provider === 'stripe' ? 'STRIPE (TEST MODE)' : `${row.provider} (SANDBOX)`}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span
          className={`text-xs uppercase font-semibold ${
            row.status === 'paid'
              ? 'text-primary'
              : row.status === 'pending'
                ? 'text-warning'
                : 'text-destructive'
          }`}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDateDhaka(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => (
        <span className="font-mono font-semibold tabular-nums">{formatBDT(row.amount)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Subscription & Billing Portal
          </h1>
          <p className="text-xs text-muted-foreground">
            SSLCommerz Sandbox (Primary BDT Gateway) and Stripe TEST MODE with idempotent webhook
            validation.
          </p>
        </div>
        {billing && <PlanBadge plan={billing.plan} />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Current Plan & Usage Meters */}
        <div className="lg:col-span-6">
          <Card className="h-full flex flex-col justify-between">
            <CardHeader>
              <CardDescription>Current Shop Plan</CardDescription>
              <CardTitle className="text-2xl flex items-center justify-between">
                <span>
                  {billing?.plan === 'pro' ? 'DokanOS Pro (৳499 / 30d)' : 'DokanOS Free Plan'}
                </span>
                <ShieldCheck className="h-5 w-5 text-primary" />
              </CardTitle>
              {billing?.planExpiresAt && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Current 30-day period valid until {formatDateDhaka(billing.planExpiresAt)}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active Products</span>
                  <span className="font-mono tabular-nums font-semibold">
                    {billing?.usage.productCount ?? 0} /{' '}
                    {billing?.limits.maxProducts ?? 'Unlimited'}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: billing?.limits.maxProducts
                        ? `${Math.min(100, ((billing.usage.productCount ?? 0) / billing.limits.maxProducts) * 100)}%`
                        : '22%',
                    }}
                  />
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Staff & Manager Accounts</span>
                  <span className="font-mono tabular-nums font-semibold">
                    {billing?.usage.staffCount ?? 0} / {billing?.limits.maxStaff ?? 1}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${Math.min(100, ((billing?.usage.staffCount ?? 0) / (billing?.limits.maxStaff ?? 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-border grid grid-cols-2 gap-2 text-xs">
                <div>
                  CSV Import / Export:{' '}
                  <strong className="text-foreground">
                    {billing?.limits.csvImportExport ? 'Enabled' : 'Pro Only'}
                  </strong>
                </div>
                <div>
                  Email Digests:{' '}
                  <strong className="text-foreground">
                    {billing?.limits.emailDigests ? 'Enabled' : 'Pro Only'}
                  </strong>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Gateway Checkout Actions */}
        <div className="lg:col-span-6">
          <Card className="h-full flex flex-col justify-between">
            <CardHeader>
              <CardTitle>Upgrade or Extend Pro (30 Days — ৳499)</CardTitle>
              <CardDescription>
                Local Bangladeshi gateways use one-off 30-day payments. Every callback is verified
                server-side and deduplicated on <code>{'{ provider, eventId }'}</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full justify-between"
                disabled={initSslCommerzMutation.isPending}
                onClick={() => initSslCommerzMutation.mutate()}
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Pay ৳499 via SSLCommerz (Sandbox Primary)
                </span>
                <span className="font-mono text-xs">Test Visa 4111...</span>
              </Button>

              <Button
                variant="outline"
                className="w-full justify-between"
                disabled={initStripeTestMutation.isPending}
                onClick={() => initStripeTestMutation.mutate()}
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Pay ৳499 via Stripe Checkout (TEST MODE)
                </span>
                <span className="font-mono text-xs">Test Card 4242...</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => bkashStubMutation.mutate()}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Test bKash Tokenized Provider Seam (501 Stub)
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Invoice / Payment History */}
      <div className="space-y-3">
        <h2 className="font-display text-base font-semibold">Gateway Transaction History</h2>
        <DataTable
          columns={paymentColumns}
          data={billing?.payments ?? []}
          rowKey={(r) => r._id}
          loading={isLoading}
        />
      </div>

      {/* SSLCommerz Sandbox / Stripe Test Mode Checkout Modal */}
      {sandboxModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-md max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-display text-lg font-bold">
                  {sandboxModal.provider === 'sslcommerz'
                    ? 'SSLCommerz Sandbox Gateway'
                    : 'Stripe Checkout (TEST MODE)'}
                </h3>
                <p className="text-xs font-mono text-muted-foreground">
                  tran_id: {sandboxModal.tranId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSandboxModal(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3 rounded-md bg-secondary/60 border border-border text-xs space-y-1">
              <div className="flex justify-between">
                <span>Product:</span>
                <strong>DokanOS Pro (30 Days)</strong>
              </div>
              <div className="flex justify-between">
                <span>Amount:</span>
                <strong className="font-mono tabular-nums">
                  {formatBDT(sandboxModal.amount)}
                </strong>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="test-card" className="text-xs">
                  Sandbox Test Card Number
                </Label>
                <Input
                  id="test-card"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Expiry / CVV</Label>
                  <Input value="12/26 · 111" readOnly className="font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="test-otp" className="text-xs">
                    Sandbox OTP
                  </Label>
                  <Input
                    id="test-otp"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setSandboxModal(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={completeSandboxPaymentMutation.isPending}
                onClick={() => completeSandboxPaymentMutation.mutate()}
              >
                {completeSandboxPaymentMutation.isPending
                  ? 'Validating Server-Side...'
                  : `Authorize Test Payment (${formatBDT(sandboxModal.amount)})`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
