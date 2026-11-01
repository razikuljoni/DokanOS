import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCheck,
  CloudOff,
  CreditCard,
  Download,
  PackageMinus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  ShoppingCart,
  X,
} from 'lucide-react';
import { PRO_PRICE_BDT } from '@dokanos/shared';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useIsOffline } from '@/stores/offlineStore';
import { ApiClientError, apiFetch } from '@/lib/api';
import { getTenantSnapshot } from '@/lib/offlineCache';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, EmptyState, PlanBadge, type DataTableColumn } from '@/components/SharedWidgets';
import { downloadCsvFile, formatBDT, formatDateDhaka } from '@/lib/utils';

// /app/alerts — Low-Stock Watchlist & Notifications Feed
interface NotificationItem {
  _id: string;
  type: 'low_stock' | 'due_reminder' | 'payment' | 'subscription';
  title: string;
  body: string;
  link: string;
  isRead: boolean;
  createdAt: string;
}

interface LowStockProductItem {
  _id: string;
  name: string;
  category: string;
  unit: 'pcs' | 'box' | 'bottle' | 'strip' | 'kg';
  sku: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  lowStockAt: number;
  isActive: boolean;
}

export function AlertsPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const isOffline = useIsOffline();
  const queryClient = useQueryClient();

  const defaultShopThreshold = tenant?.settings.lowStockThreshold ?? 5;
  const [thresholdMode, setThresholdMode] = useState<'product' | 'custom'>('product');
  const [customThresholdInput, setCustomThresholdInput] = useState<string>(
    String(defaultShopThreshold),
  );
  const [severityFilter, setSeverityFilter] = useState<'all' | 'out' | 'low'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const parsedCustomThreshold = useMemo(() => {
    const num = Number(customThresholdInput);
    if (!Number.isFinite(num) || num < 0) return defaultShopThreshold;
    return Math.floor(num);
  }, [customThresholdInput, defaultShopThreshold]);

  const { data: lowStockData, isLoading: isLowStockLoading } = useQuery({
    queryKey: [
      'products',
      tenant?.id,
      'low-stock-watchlist',
      {
        mode: thresholdMode,
        threshold: thresholdMode === 'custom' ? parsedCustomThreshold : null,
        offline: isOffline,
      },
    ],
    queryFn: async (): Promise<{ data: LowStockProductItem[]; fromCache?: boolean }> => {
      if (!tenant?.id) return { data: [] };

      const filterCachedProducts = (products: LowStockProductItem[]): LowStockProductItem[] => {
        return products
          .filter((p) => p.isActive !== false)
          .filter((p) =>
            thresholdMode === 'custom' ? p.stock <= parsedCustomThreshold : p.stock <= p.lowStockAt,
          )
          .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
      };

      if (isOffline) {
        const snap = await getTenantSnapshot<LowStockProductItem[]>(tenant.id, 'pos-products');
        return {
          data: filterCachedProducts(snap?.data ?? []),
          fromCache: true,
        };
      }

      try {
        const query =
          thresholdMode === 'custom' ? `?threshold=${encodeURIComponent(parsedCustomThreshold)}` : '';
        const res = await apiFetch<{ data: LowStockProductItem[] }>(
          `/api/v1/products/low-stock${query}`,
        );
        return { data: res.data, fromCache: false };
      } catch (err) {
        if (!(err instanceof ApiClientError)) {
          const snap = await getTenantSnapshot<LowStockProductItem[]>(tenant.id, 'pos-products');
          if (snap) {
            return {
              data: filterCachedProducts(snap.data),
              fromCache: true,
            };
          }
        }
        throw err;
      }
    },
    enabled: Boolean(tenant?.id),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', tenant?.id, 'list'],
    queryFn: () => apiFetch<{ data: NotificationItem[] }>('/api/v1/notifications?limit=50'),
    enabled: Boolean(tenant?.id) && !isOffline,
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

  const allLowStockProducts = lowStockData?.data ?? [];

  const filteredLowStockProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allLowStockProducts.filter((product) => {
      if (severityFilter === 'out' && product.stock !== 0) return false;
      if (severityFilter === 'low' && product.stock === 0) return false;
      if (!q) return true;
      return (
        product.name.toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q) ||
        product.category.toLowerCase().includes(q)
      );
    });
  }, [allLowStockProducts, severityFilter, searchQuery]);

  const watchlistSummary = useMemo(() => {
    let outOfStockCount = 0;
    let criticalLowCount = 0;
    let totalShortageUnits = 0;
    let estimatedRestockCostBdt = 0;

    for (const item of allLowStockProducts) {
      const effectiveThreshold =
        thresholdMode === 'custom' ? parsedCustomThreshold : item.lowStockAt;
      const shortage = Math.max(1, effectiveThreshold - item.stock + 1);
      if (item.stock <= 0) {
        outOfStockCount += 1;
      } else {
        criticalLowCount += 1;
      }
      totalShortageUnits += shortage;
      estimatedRestockCostBdt += shortage * item.costPrice;
    }

    return {
      totalFlagged: allLowStockProducts.length,
      outOfStockCount,
      criticalLowCount,
      totalShortageUnits,
      estimatedRestockCostBdt,
    };
  }, [allLowStockProducts, thresholdMode, parsedCustomThreshold]);

  const handleExportLowStockCsv = (): void => {
    if (filteredLowStockProducts.length === 0) {
      addToast({
        title: 'No Low-Stock Items to Export',
        description: 'There are no products matching the current threshold filter.',
        variant: 'warning',
      });
      return;
    }

    const headers = [
      'SKU',
      'Product Name',
      'Category',
      'Unit',
      'Status',
      'Current Stock',
      'Defined Threshold',
      'Suggested Reorder Qty',
      'Unit Cost (BDT)',
      'Est. Restock Cost (BDT)',
    ];

    const rows = filteredLowStockProducts.map((item) => {
      const effectiveThreshold =
        thresholdMode === 'custom' ? parsedCustomThreshold : item.lowStockAt;
      const reorderQty = Math.max(1, effectiveThreshold - item.stock + 1);
      const restockCost = reorderQty * item.costPrice;
      return [
        item.sku,
        item.name,
        item.category,
        item.unit,
        item.stock <= 0 ? 'OUT_OF_STOCK' : 'BELOW_THRESHOLD',
        item.stock,
        effectiveThreshold,
        reorderQty,
        item.costPrice,
        restockCost,
      ];
    });

    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadCsvFile(
      `dokanos-low-stock-alerts-${tenant?.slug ?? 'shop'}-${dateStamp}.csv`,
      headers,
      rows,
    );

    addToast({
      title: 'Low-Stock Watchlist Exported',
      description: `Downloaded ${rows.length} flagged product${rows.length === 1 ? '' : 's'} as CSV.`,
      variant: 'success',
    });
  };

  const lowStockColumns: DataTableColumn<LowStockProductItem>[] = [
    {
      key: 'sku',
      header: 'SKU',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.sku}</span>,
    },
    {
      key: 'name',
      header: 'Product',
      render: (row) => (
        <div>
          <Link
            to={`/app/products/${row._id}`}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.name}
          </Link>
          <div className="text-[11px] text-muted-foreground">{row.category}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Alert Status',
      render: (row) =>
        row.stock <= 0 ? (
          <span className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-destructive">
            OUT OF STOCK
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/15 px-2 py-0.5 text-[11px] font-mono font-semibold text-warning">
            BELOW THRESHOLD
          </span>
        ),
    },
    {
      key: 'stock',
      header: 'Current Stock',
      align: 'right',
      render: (row) => (
        <span
          className={`font-mono font-semibold tabular-nums ${
            row.stock <= 0 ? 'text-destructive' : 'text-warning'
          }`}
        >
          {row.stock} {row.unit}
        </span>
      ),
    },
    {
      key: 'threshold',
      header: 'Defined Threshold',
      align: 'right',
      render: (row) => {
        const effectiveThreshold =
          thresholdMode === 'custom' ? parsedCustomThreshold : row.lowStockAt;
        return (
          <div className="text-right">
            <span className="font-mono text-xs tabular-nums text-foreground">
              ≤ {effectiveThreshold} {row.unit}
            </span>
            {thresholdMode === 'custom' && row.lowStockAt !== parsedCustomThreshold && (
              <div className="text-[10px] font-mono text-muted-foreground">
                Item default: {row.lowStockAt}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'deficit',
      header: 'Suggested Reorder',
      align: 'right',
      render: (row) => {
        const effectiveThreshold =
          thresholdMode === 'custom' ? parsedCustomThreshold : row.lowStockAt;
        const reorderQty = Math.max(1, effectiveThreshold - row.stock + 1);
        const estCost = reorderQty * row.costPrice;
        return (
          <div className="text-right">
            <div className="font-mono text-xs font-semibold text-primary tabular-nums">
              +{reorderQty} {row.unit}
            </div>
            <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
              Est. {formatBDT(estCost)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <Link to={`/app/products/${row._id}`}>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
              Inspect
              <ArrowUpRight className="h-3 w-3" />
            </Button>
          </Link>
          <Link to="/app/purchases">
            <Button variant="secondary" size="sm" className="h-7 px-2 text-xs">
              <ShoppingCart className="h-3 w-3" />
              Restock
            </Button>
          </Link>
        </div>
      ),
    },
  ];

  const items = data?.data ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Alerts & Inventory Watchlist
          </h1>
          <p className="text-xs text-muted-foreground">
            Automatic low-stock threshold detection, reorder calculations, and real-time shop
            notifications.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportLowStockCsv}
            disabled={filteredLowStockProducts.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export Low-Stock CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isOffline || markAllReadMutation.isPending || items.every((i) => i.isRead)}
            onClick={() => markAllReadMutation.mutate()}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark All Alerts Read
          </Button>
        </div>
      </div>

      {/* Dedicated Low-Stock Inventory Section */}
      <section aria-labelledby="low-stock-heading" className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <PackageMinus className="h-4 w-4 text-warning" />
              <h2 id="low-stock-heading" className="font-display text-lg font-bold tracking-tight">
                Low-Stock Inventory Watchlist
              </h2>
              <span className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-xs font-semibold tabular-nums">
                {watchlistSummary.totalFlagged} Flagged
              </span>
              {lowStockData?.fromCache && (
                <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/15 px-2 py-0.5 font-mono text-[11px] text-warning">
                  <CloudOff className="h-3 w-3" />
                  Offline Snapshot
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Automatically identifies active products whose stock quantity is at or below the
              defined reorder threshold.
            </p>
          </div>

          {/* Threshold Mode Selector & Custom Threshold Input */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setThresholdMode('product')}
                className={`px-2.5 py-1 rounded-sm font-medium transition-colors cursor-pointer ${
                  thresholdMode === 'product'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Per-Product Threshold
              </button>
              <button
                type="button"
                onClick={() => setThresholdMode('custom')}
                className={`px-2.5 py-1 rounded-sm font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                  thresholdMode === 'custom'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <SlidersHorizontal className="h-3 w-3" />
                Custom Threshold
              </button>
            </div>

            {thresholdMode === 'custom' && (
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1">
                <Label
                  htmlFor="custom-stock-threshold"
                  className="text-xs text-muted-foreground whitespace-nowrap"
                >
                  Stock ≤
                </Label>
                <Input
                  id="custom-stock-threshold"
                  type="number"
                  min={0}
                  max={10000}
                  value={customThresholdInput}
                  onChange={(e) => setCustomThresholdInput(e.target.value)}
                  className="h-6 w-16 px-1.5 py-0 font-mono text-xs tabular-nums"
                />
                <div className="flex items-center gap-1 pl-1 border-l border-border">
                  {[5, 10, 20].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCustomThresholdInput(String(preset))}
                      className={`px-1.5 py-0.5 rounded text-[11px] font-mono cursor-pointer ${
                        parsedCustomThreshold === preset
                          ? 'bg-secondary font-semibold text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      ≤{preset}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Flagged Inventory Items</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
                {watchlistSummary.totalFlagged}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground">
                {thresholdMode === 'custom'
                  ? `Stock ≤ ${parsedCustomThreshold} units`
                  : 'Stock ≤ item lowStockAt'}
              </span>
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Out of Stock (0 Qty)</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span
                className={`font-mono text-2xl font-bold tabular-nums ${
                  watchlistSummary.outOfStockCount > 0 ? 'text-destructive' : 'text-foreground'
                }`}
              >
                {watchlistSummary.outOfStockCount}
              </span>
              <span className="text-[11px] font-mono text-destructive">Immediate action</span>
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Critical Low (&gt; 0 Qty)</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span
                className={`font-mono text-2xl font-bold tabular-nums ${
                  watchlistSummary.criticalLowCount > 0 ? 'text-warning' : 'text-foreground'
                }`}
              >
                {watchlistSummary.criticalLowCount}
              </span>
              <span className="text-[11px] font-mono text-warning">Near depletion</span>
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Est. Restock Requirement</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold tabular-nums text-primary">
                {formatBDT(watchlistSummary.estimatedRestockCostBdt)}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                +{watchlistSummary.totalShortageUnits} units
              </span>
            </div>
          </Card>
        </div>

        {/* Search & Severity Filter Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative max-w-sm w-full">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter low-stock by name, SKU, or category..."
              className="pl-8 h-8 text-xs"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setSeverityFilter('all')}
              className={`px-2.5 py-1 rounded border font-mono text-xs cursor-pointer ${
                severityFilter === 'all'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              All ({watchlistSummary.totalFlagged})
            </button>
            <button
              type="button"
              onClick={() => setSeverityFilter('out')}
              className={`px-2.5 py-1 rounded border font-mono text-xs cursor-pointer ${
                severityFilter === 'out'
                  ? 'border-destructive bg-destructive text-white'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              Out of Stock ({watchlistSummary.outOfStockCount})
            </button>
            <button
              type="button"
              onClick={() => setSeverityFilter('low')}
              className={`px-2.5 py-1 rounded border font-mono text-xs cursor-pointer ${
                severityFilter === 'low'
                  ? 'border-warning bg-warning text-white'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              Below Threshold ({watchlistSummary.criticalLowCount})
            </button>
          </div>
        </div>

        <DataTable
          columns={lowStockColumns}
          data={filteredLowStockProducts}
          rowKey={(row) => row._id}
          loading={isLowStockLoading}
          emptyTitle="All inventory items are stocked above threshold"
          emptyDescription={
            thresholdMode === 'custom'
              ? `No active products have stock quantities at or below ${parsedCustomThreshold} units.`
              : 'Every active product in your catalog currently exceeds its defined low-stock reorder point.'
          }
        />
      </section>

      {/* Real-time Notification Feed */}
      <section aria-labelledby="notifications-feed-heading" className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2
            id="notifications-feed-heading"
            className="font-display text-lg font-bold tracking-tight"
          >
            Activity & System Notifications Feed
          </h2>
          <p className="text-xs text-muted-foreground">
            Chronological log of triggered low-stock alerts, Baki due reminders, and billing events.
          </p>
        </div>

        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading alerts...</div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No notifications in feed"
            description="Low-stock triggers and Baki reminders will appear here automatically."
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
      </section>
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

  const callbackStatus = searchParams.get('status');
  const callbackTranId = searchParams.get('tran_id');

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
      if (res.data.GatewayPageURL.startsWith('http')) {
        window.location.assign(res.data.GatewayPageURL);
        return;
      }
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
      if (res.data.checkoutUrl.startsWith('http')) {
        window.location.assign(res.data.checkoutUrl);
        return;
      }
      setCardNumber('4242424242424242');
      setSandboxModal({
        provider: 'stripe',
        tranId: res.data.tranId,
        amount: res.data.amount,
      });
    },
  });

  const cancelPlanMutation = useMutation({
    mutationFn: async (immediate: boolean) => {
      return apiFetch('/api/v1/billing/cancel', {
        method: 'POST',
        body: JSON.stringify({ immediate }),
      });
    },
    onSuccess: (_, immediate) => {
      if (immediate) {
        updateTenant({ plan: 'free', planExpiresAt: null });
      }
      void queryClient.invalidateQueries({ queryKey: ['billing', tenant?.id] });
      addToast({
        title: immediate ? 'Switched to Free Plan' : 'Subscription Renewal Cancelled',
        description: immediate
          ? 'Your shop is now on the Free plan.'
          : 'Your Pro plan remains active until the end of the current 30-day period.',
        variant: 'warning',
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
            SSLCommerz SANDBOX (Primary BDT Gateway) and Stripe TEST MODE with idempotent webhook
            validation.
          </p>
        </div>
        {billing && <PlanBadge plan={billing.plan} />}
      </div>

      {callbackStatus && (
        <div
          className={`rounded-md border px-4 py-3 flex items-center justify-between gap-3 text-xs ${
            callbackStatus === 'success'
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-warning bg-warning/15 text-warning'
          }`}
        >
          <span>
            {callbackStatus === 'success'
              ? `Payment verified via SSLCommerz Sandbox (${callbackTranId ?? 'N/A'}) — DokanOS Pro is active for 30 days.`
              : `Gateway checkout ${callbackStatus} (${callbackTranId ?? 'N/A'}). No charges were applied.`}
          </span>
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="underline font-medium cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

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

        {/* Gateway Checkout Actions & Plan Management */}
        <div className="lg:col-span-6">
          <Card className="h-full flex flex-col justify-between">
            <CardHeader>
              <CardTitle>
                {billing?.plan === 'pro'
                  ? 'Manage Pro Plan · Extend 30 Days (৳499)'
                  : 'Upgrade to DokanOS Pro (30 Days — ৳499)'}
              </CardTitle>
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
                  {billing?.plan === 'pro'
                    ? 'Extend +30 Days via SSLCommerz (SANDBOX)'
                    : 'Upgrade ৳499 via SSLCommerz (SANDBOX)'}
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
                  {billing?.plan === 'pro'
                    ? 'Extend +30 Days via Stripe (TEST MODE)'
                    : 'Upgrade ৳499 via Stripe Checkout (TEST MODE)'}
                </span>
                <span className="font-mono text-xs">Test Card 4242...</span>
              </Button>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => bkashStubMutation.mutate()}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Test bKash Tokenized Seam (501 Stub)
                </Button>

                {billing?.plan === 'pro' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    disabled={cancelPlanMutation.isPending}
                    onClick={() => cancelPlanMutation.mutate(true)}
                  >
                    Switch to Free Plan (Demo Toggle)
                  </Button>
                )}
              </div>
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
                    ? 'SSLCommerz SANDBOX Gateway'
                    : 'Stripe Checkout (TEST MODE)'}
                </h3>
                <p className="text-xs font-mono text-muted-foreground">
                  tran_id: {sandboxModal.tranId}
                </p>
                <p className="text-[11px] font-mono text-warning mt-1">
                  Sandbox simulator — no real gateway call in development
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
