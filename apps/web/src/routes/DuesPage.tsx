import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Banknote, CloudOff, Database, Search, X } from 'lucide-react';
import { PAYMENT_METHODS, type PaymentMethod } from '@dokanos/shared';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useIsOffline, useOfflineStore } from '@/stores/offlineStore';
import { apiFetch, ApiClientError } from '@/lib/api';
import {
  applyOfflineDuePaymentToSnapshots,
  enqueueOutboxItem,
  getTenantSnapshot,
  saveTenantSnapshot,
  type CachedDuesSummary,
  type CachedUnifiedDueItem,
} from '@/lib/offlineCache';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ChartCard,
  DataTable,
  StatCard,
  type DataTableColumn,
} from '@/components/SharedWidgets';
import { formatBDT, formatDateDhaka } from '@/lib/utils';

type UnifiedDueItem = CachedUnifiedDueItem;
type DuesSummary = CachedDuesSummary;

function filterCachedDues(
  items: UnifiedDueItem[],
  partyFilter: 'all' | 'customer' | 'supplier',
  bucketFilter: 'all' | '0-7' | '8-30' | '30+',
  search: string,
): UnifiedDueItem[] {
  const q = search.trim().toLowerCase();
  return items.filter((item) => {
    if (partyFilter !== 'all' && item.partyType !== partyFilter) return false;
    if (bucketFilter !== 'all' && item.ageingBucket !== bucketFilter) return false;
    if (!q) return true;
    return (
      item.partyName.toLowerCase().includes(q) ||
      item.partyPhone.toLowerCase().includes(q) ||
      item.refNo.toLowerCase().includes(q)
    );
  });
}

export function DuesPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const isOffline = useIsOffline();
  const refreshOfflineState = useOfflineStore((s) => s.refreshOfflineState);
  const setDrawerOpen = useOfflineStore((s) => s.setDrawerOpen);
  const outboxCount = useOfflineStore((s) => s.outboxItems.length);
  const queryClient = useQueryClient();

  const [partyFilter, setPartyFilter] = useState<'all' | 'customer' | 'supplier'>('all');
  const [bucketFilter, setBucketFilter] = useState<'all' | '0-7' | '8-30' | '30+'>('all');
  const [search, setSearch] = useState('');
  const [paymentTarget, setPaymentTarget] = useState<UnifiedDueItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');

  const { data: summaryRes, isLoading: summaryLoading } = useQuery({
    queryKey: ['dues', tenant?.id, 'summary', isOffline ? 'offline' : 'online'],
    queryFn: async (): Promise<{ data: DuesSummary; fromCache?: boolean }> => {
      if (!tenant?.id) {
        return {
          data: {
            totalReceivable: 0,
            totalPayable: 0,
            netPosition: 0,
            customerCount: 0,
            supplierCount: 0,
            buckets: {
              '0-7': { receivable: 0, payable: 0, count: 0 },
              '8-30': { receivable: 0, payable: 0, count: 0 },
              '30+': { receivable: 0, payable: 0, count: 0 },
            },
          },
        };
      }

      if (isOffline) {
        const snap = await getTenantSnapshot<DuesSummary>(tenant.id, 'dues-summary');
        if (snap) return { data: snap.data, fromCache: true };
      }

      try {
        const res = await apiFetch<{ data: DuesSummary }>('/api/v1/dues/summary');
        await saveTenantSnapshot(tenant.id, 'dues-summary', res.data);
        return { data: res.data, fromCache: false };
      } catch (err) {
        if (!(err instanceof ApiClientError)) {
          const snap = await getTenantSnapshot<DuesSummary>(tenant.id, 'dues-summary');
          if (snap) return { data: snap.data, fromCache: true };
        }
        throw err;
      }
    },
    enabled: Boolean(tenant?.id),
  });

  const { data: duesRes, isLoading: duesLoading } = useQuery({
    queryKey: [
      'dues',
      tenant?.id,
      { partyFilter, bucketFilter, search, mode: isOffline ? 'offline' : 'online' },
    ],
    queryFn: async (): Promise<{ data: UnifiedDueItem[]; fromCache?: boolean }> => {
      if (!tenant?.id) return { data: [] };

      if (isOffline) {
        const snap = await getTenantSnapshot<UnifiedDueItem[]>(tenant.id, 'dues-list');
        return {
          data: filterCachedDues(snap?.data ?? [], partyFilter, bucketFilter, search),
          fromCache: true,
        };
      }

      try {
        const params = new URLSearchParams();
        if (partyFilter !== 'all') params.set('partyType', partyFilter);
        if (bucketFilter !== 'all') params.set('bucket', bucketFilter);
        if (search.trim()) params.set('search', search.trim());
        const res = await apiFetch<{ data: UnifiedDueItem[] }>(
          `/api/v1/dues?${params.toString()}`,
        );

        // When loading unfiltered ledger, persist full snapshot to IndexedDB for offline access
        if (partyFilter === 'all' && bucketFilter === 'all' && !search.trim()) {
          await saveTenantSnapshot(tenant.id, 'dues-list', res.data);
          await refreshOfflineState(tenant.id);
        }
        return { data: res.data, fromCache: false };
      } catch (err) {
        if (!(err instanceof ApiClientError)) {
          const snap = await getTenantSnapshot<UnifiedDueItem[]>(tenant.id, 'dues-list');
          if (snap) {
            return {
              data: filterCachedDues(snap.data, partyFilter, bucketFilter, search),
              fromCache: true,
            };
          }
        }
        throw err;
      }
    },
    enabled: Boolean(tenant?.id),
  });

  const queueOfflineDuePayment = async (): Promise<{ queuedOffline: boolean }> => {
    if (!tenant?.id || !paymentTarget) {
      throw new Error('Missing payment target');
    }

    const rawAmt = Number(paymentAmount);
    const { appliedAmount } = await applyOfflineDuePaymentToSnapshots(
      tenant.id,
      paymentTarget,
      rawAmt,
    );

    const nowIso = new Date().toISOString();
    await enqueueOutboxItem({
      id: `offline-due-${Date.now()}`,
      tenantId: tenant.id,
      type: 'due_payment',
      title: `Baki Payment (${paymentTarget.refNo})`,
      subtitle: `${paymentTarget.partyName} · ${paymentMethod.toUpperCase()}`,
      amount: appliedAmount,
      createdAt: nowIso,
      status: 'pending',
      duePaymentPayload: {
        refId: paymentTarget.refId,
        amount: appliedAmount,
        method: paymentMethod,
      },
    });

    await refreshOfflineState(tenant.id);
    return { queuedOffline: true };
  };

  const recordPaymentMutation = useMutation({
    mutationFn: async (): Promise<{ queuedOffline: boolean }> => {
      if (!paymentTarget) return { queuedOffline: false };

      if (isOffline) {
        return queueOfflineDuePayment();
      }

      try {
        await apiFetch(`/api/v1/dues/${paymentTarget.refId}/payments`, {
          method: 'POST',
          body: JSON.stringify({
            amount: Number(paymentAmount),
            method: paymentMethod,
          }),
        });
        return { queuedOffline: false };
      } catch (err) {
        if (!(err instanceof ApiClientError)) {
          return queueOfflineDuePayment();
        }
        throw err;
      }
    },
    onSuccess: (result) => {
      setPaymentTarget(null);
      setPaymentAmount('');
      void queryClient.invalidateQueries({ queryKey: ['dues', tenant?.id] });

      if (!result.queuedOffline) {
        void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant?.id] });
        void queryClient.invalidateQueries({ queryKey: ['sales', tenant?.id] });
        void queryClient.invalidateQueries({ queryKey: ['purchases', tenant?.id] });
        void queryClient.invalidateQueries({ queryKey: ['suppliers', tenant?.id] });
        addToast({
          title: 'Baki Payment Recorded',
          description: 'Outstanding balance updated in an atomic transaction.',
          variant: 'success',
        });
      } else {
        addToast({
          title: 'Offline Baki Payment Queued',
          description:
            'Local Baki balance updated immediately and queued in Outbox for MongoDB sync.',
          variant: 'warning',
        });
      }
    },
    onError: (err) => {
      addToast({
        title: 'Payment Failed',
        description: err instanceof Error ? err.message : 'Could not record payment',
        variant: 'danger',
      });
    },
  });

  const summary = summaryRes?.data;
  const chartData = summary
    ? [
        {
          bucket: '0–7 Days',
          Receivable: summary.buckets['0-7'].receivable,
          Payable: summary.buckets['0-7'].payable,
        },
        {
          bucket: '8–30 Days',
          Receivable: summary.buckets['8-30'].receivable,
          Payable: summary.buckets['8-30'].payable,
        },
        {
          bucket: '30+ Days',
          Receivable: summary.buckets['30+'].receivable,
          Payable: summary.buckets['30+'].payable,
        },
      ]
    : [];

  const columns: DataTableColumn<UnifiedDueItem>[] = [
    {
      key: 'refNo',
      header: 'Reference',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold">{row.refNo}</span>
          {row.isOfflineQueued && (
            <span className="px-1.5 py-0.5 rounded bg-warning/15 text-warning text-[10px] font-mono">
              Offline
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'party',
      header: 'Party & Type',
      render: (row) => (
        <div>
          <div className="font-medium text-foreground">{row.partyName}</div>
          <div className="text-xs text-muted-foreground">
            <span
              className={
                row.partyType === 'customer' ? 'text-primary font-medium' : 'text-warning font-medium'
              }
            >
              {row.partyType === 'customer' ? 'Customer Receivable' : 'Supplier Payable'}
            </span>
            {row.partyPhone ? ` · ${row.partyPhone}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'ageing',
      header: 'Ageing Bucket',
      render: (row) => (
        <span
          className={`text-xs font-mono tabular-nums ${
            row.ageingBucket === '30+'
              ? 'text-destructive font-semibold'
              : row.ageingBucket === '8-30'
                ? 'text-warning font-medium'
                : 'text-muted-foreground'
          }`}
        >
          {row.ageDays}d ({row.ageingBucket} days)
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Origin Date',
      render: (row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDateDhaka(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Original Bill',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatBDT(row.totalAmount)}
        </span>
      ),
    },
    {
      key: 'dueAmount',
      header: 'Remaining Due',
      align: 'right',
      render: (row) => (
        <span className="font-mono font-bold tabular-nums text-foreground">
          {formatBDT(row.dueAmount)}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Settle',
      align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setPaymentTarget(row);
            setPaymentAmount(String(row.dueAmount));
          }}
        >
          <Banknote className="h-3.5 w-3.5" />
          Record Payment
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Baki (Credit &amp; Dues) Ledger
          </h1>
          <p className="text-xs text-muted-foreground">
            Unified customer receivables and supplier payables with 0–7, 8–30, and 30+ day ageing
            analysis. Remains functional offline via local IndexedDB cache.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(isOffline || duesRes?.fromCache) && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-warning/40 bg-warning/15 text-warning text-xs font-medium">
              <CloudOff className="h-3.5 w-3.5" />
              Local Baki Cache Active
            </span>
          )}
          {outboxCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => setDrawerOpen(true)}>
              <Database className="h-3.5 w-3.5 text-primary" />
              Outbox ({outboxCount})
            </Button>
          )}
        </div>
      </div>

      {/* 3 KPI Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Customer Receivable (Owed to Shop)"
          value={formatBDT(summary?.totalReceivable ?? 0)}
          subtext={`${summary?.customerCount ?? 0} open customer credit bills`}
          tone="primary"
          loading={summaryLoading}
        />
        <StatCard
          label="Supplier Payable (Shop Owes)"
          value={formatBDT(summary?.totalPayable ?? 0)}
          subtext={`${summary?.supplierCount ?? 0} open supplier purchase orders`}
          tone="warning"
          loading={summaryLoading}
        />
        <StatCard
          label="Net Baki Position (Receivable − Payable)"
          value={formatBDT(summary?.netPosition ?? 0)}
          subtext="Net working credit balance"
          loading={summaryLoading}
        />
      </div>

      {/* Ageing Buckets BarChart */}
      <ChartCard
        title="Baki Ageing Breakdown (0–7 Days, 8–30 Days, 30+ Days)"
        description="Compare customer receivables against supplier payables by age"
        loading={summaryLoading}
      >
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E7E0D4" />
              <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: '#1C1917' }} />
              <YAxis
                tick={{ fontSize: 11, fill: '#57534E' }}
                tickFormatter={(v: number) => `৳${v}`}
              />
              <Tooltip formatter={(val: number) => `৳${val.toLocaleString()}`} />
              <Legend />
              <Bar dataKey="Receivable" fill="#14532D" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Payable" fill="#B45309" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer, supplier, phone, or invoice..."
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-secondary rounded-md">
            {(
              [
                { id: 'all', label: 'All Parties' },
                { id: 'customer', label: 'Receivables' },
                { id: 'supplier', label: 'Payables' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPartyFilter(p.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  partyFilter === p.id
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-secondary rounded-md">
            {(['all', '0-7', '8-30', '30+'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucketFilter(b)}
                className={`px-2.5 py-1.5 text-xs font-mono rounded transition-colors cursor-pointer ${
                  bucketFilter === b
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {b === 'all' ? 'All Ages' : `${b}d`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={duesRes?.data ?? []}
        rowKey={(r) => r.refId}
        loading={duesLoading}
        emptyTitle="No open Baki dues — nice."
        emptyDescription="All customer credit bills and supplier purchase orders are settled."
      />

      {/* DuePaymentDialog */}
      {paymentTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-md max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                Record {paymentTarget.partyType === 'customer' ? 'Customer' : 'Supplier'} Payment
              </h3>
              <button
                type="button"
                onClick={() => setPaymentTarget(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                Party: <strong className="text-foreground">{paymentTarget.partyName}</strong> (
                {paymentTarget.refNo})
              </div>
              <div>
                Outstanding Due:{' '}
                <strong className="font-mono text-foreground">
                  {formatBDT(paymentTarget.dueAmount)}
                </strong>
              </div>
              {isOffline && (
                <div className="pt-1 text-warning font-medium">
                  Offline Mode: Payment will update local Baki balance immediately and queue in
                  Outbox.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="due-amt">Payment Amount (৳)</Label>
                <Input
                  id="due-amt"
                  type="number"
                  min={1}
                  max={paymentTarget.dueAmount}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="font-mono tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <Label>Payment Method</Label>
                <div className="grid grid-cols-4 gap-1.5 p-1 bg-secondary rounded-md">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`py-1.5 rounded text-xs font-medium uppercase cursor-pointer ${
                        paymentMethod === m
                          ? 'bg-primary text-white'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setPaymentTarget(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={recordPaymentMutation.isPending || Number(paymentAmount) <= 0}
                onClick={() => recordPaymentMutation.mutate()}
              >
                {recordPaymentMutation.isPending
                  ? 'Recording...'
                  : isOffline
                    ? 'Queue Offline Payment'
                    : 'Confirm Payment'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
