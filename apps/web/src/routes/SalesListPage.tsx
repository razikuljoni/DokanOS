import React, { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudOff, Eye, Plus, Printer, RotateCcw, Search, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useIsOffline } from '@/stores/offlineStore';
import { apiFetch, ApiClientError } from '@/lib/api';
import { getTenantSnapshot, saveTenantSnapshot } from '@/lib/offlineCache';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type DataTableColumn } from '@/components/SharedWidgets';
import { formatBDT, formatDateDhaka } from '@/lib/utils';
import type { PaginationMeta } from '@dokanos/shared';

interface SaleRecord {
  _id: string;
  invoiceNo: string;
  items: Array<{
    productId: string;
    name: string;
    qty: number;
    price: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string;
  paymentStatus: 'paid' | 'partial' | 'due';
  customerName: string;
  customerPhone: string;
  isReturned: boolean;
  soldBy?: { name: string; role: string };
  createdAt: string;
}

export function SalesListPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const user = useAuthStore((s) => s.user);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(null);

  const isOffline = useIsOffline();
  const canReturn = user?.role === 'owner' || user?.role === 'manager';

  const { data, isLoading } = useQuery({
    queryKey: ['sales', tenant?.id, { page, search, statusFilter, mode: isOffline ? 'offline' : 'online' }],
    queryFn: async (): Promise<{ data: SaleRecord[]; meta?: PaginationMeta; fromCache?: boolean }> => {
      if (!tenant?.id) return { data: [] };

      if (isOffline) {
        const snap = await getTenantSnapshot<SaleRecord[]>(tenant.id, 'sales-list');
        const list = (snap?.data ?? []).filter((row) => {
          if (statusFilter !== 'all' && row.paymentStatus !== statusFilter) return false;
          if (!search.trim()) return true;
          const q = search.trim().toLowerCase();
          return (
            row.invoiceNo.toLowerCase().includes(q) ||
            row.customerName.toLowerCase().includes(q) ||
            row.customerPhone.toLowerCase().includes(q)
          );
        });
        return { data: list, fromCache: true };
      }

      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: '15',
        });
        if (search.trim()) params.set('search', search.trim());
        if (statusFilter !== 'all') params.set('paymentStatus', statusFilter);
        const res = await apiFetch<{ data: SaleRecord[]; meta: PaginationMeta }>(
          `/api/v1/sales?${params.toString()}`,
        );
        if (page === 1 && !search.trim() && statusFilter === 'all') {
          await saveTenantSnapshot(tenant.id, 'sales-list', res.data);
        }
        return { ...res, fromCache: false };
      } catch (err) {
        if (!(err instanceof ApiClientError)) {
          const snap = await getTenantSnapshot<SaleRecord[]>(tenant.id, 'sales-list');
          if (snap) {
            return { data: snap.data, fromCache: true };
          }
        }
        throw err;
      }
    },
    enabled: Boolean(tenant?.id),
  });

  const returnMutation = useMutation({
    mutationFn: async (saleId: string) => {
      return apiFetch<{ data: SaleRecord }>(`/api/v1/sales/${saleId}/return`, {
        method: 'POST',
      });
    },
    onSuccess: (res) => {
      setSelectedSale(res.data);
      void queryClient.invalidateQueries({ queryKey: ['sales', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant?.id] });
      addToast({
        title: 'Sale Returned & Restocked',
        description: `Invoice ${res.data.invoiceNo} items returned to stock.`,
        variant: 'success',
      });
    },
    onError: (err) => {
      addToast({
        title: 'Return Failed',
        description: err instanceof Error ? err.message : 'Unable to return sale',
        variant: 'danger',
      });
    },
  });

  const columns: DataTableColumn<SaleRecord>[] = [
    {
      key: 'invoiceNo',
      header: 'Invoice #',
      render: (row) => (
        <span className="font-mono text-xs font-semibold text-foreground">
          {row.invoiceNo}
          {row.isReturned ? ' (RETURNED)' : ''}
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <div>
          <div className="font-medium text-foreground">{row.customerName}</div>
          {row.customerPhone && (
            <div className="text-xs font-mono text-muted-foreground">{row.customerPhone}</div>
          )}
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      render: (row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {row.items.length} SKU(s)
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Payment / Status',
      render: (row) => (
        <span className="text-xs">
          <span className="uppercase text-muted-foreground">{row.paymentMethod}</span>
          <span aria-hidden="true"> · </span>
          <span
            className={
              row.paymentStatus === 'paid'
                ? 'text-primary font-medium'
                : row.paymentStatus === 'partial'
                  ? 'text-warning font-medium'
                  : 'text-destructive font-medium'
            }
          >
            {row.paymentStatus.toUpperCase()}
          </span>
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
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => (
        <div>
          <div className="font-mono font-semibold tabular-nums">{formatBDT(row.total)}</div>
          {row.dueAmount > 0 && (
            <div className="text-[11px] font-mono text-warning tabular-nums">
              Due: {formatBDT(row.dueAmount)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Invoice',
      align: 'right',
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setSelectedSale(row)}>
          <Eye className="h-3.5 w-3.5" />
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Sales & Invoice Ledger</h1>
          <p className="text-xs text-muted-foreground">
            Complete audit trail of shop invoices, payment statuses, and customer returns.
          </p>
        </div>
        <Link to="/app/sales/new">
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" />
            New POS Sale
          </Button>
        </Link>
      </div>

      {(isOffline || data?.fromCache) && (
        <div className="rounded-md border border-warning/40 bg-warning/15 px-4 py-2.5 flex items-center gap-2 text-xs font-medium text-warning">
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>Offline — showing cached data</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by invoice (INV-0001) or customer..."
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-secondary rounded-md">
          {(['all', 'paid', 'partial', 'due'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => {
                setStatusFilter(st);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {st === 'all' ? 'All Invoices' : st.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        rowKey={(r) => r._id}
        loading={isLoading}
        meta={data?.meta}
        onPageChange={setPage}
      />

      {/* Sale Detail Invoice Drawer / Modal */}
      {selectedSale && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-end">
          <div className="bg-card border-l border-border h-full max-w-lg w-full p-6 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6">
              <div className="flex items-start justify-between border-b border-border pb-4">
                <div>
                  <h3 className="font-display text-lg font-bold">
                    Invoice {selectedSale.invoiceNo}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {formatDateDhaka(selectedSale.createdAt)} · Customer:{' '}
                    {selectedSale.customerName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSale(null)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Line Items</div>
                <div className="rounded-md border border-border divide-y divide-border">
                  {selectedSale.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-medium text-foreground">{item.name}</div>
                        <div className="text-muted-foreground font-mono tabular-nums">
                          {formatBDT(item.price)} × {item.qty}
                        </div>
                      </div>
                      <div className="font-mono font-semibold tabular-nums">
                        {formatBDT(item.lineTotal)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-border bg-secondary/50 p-4 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-mono tabular-nums">
                    {formatBDT(selectedSale.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-mono tabular-nums">
                    −{formatBDT(selectedSale.discount)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold text-sm pt-1 border-t border-border">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{formatBDT(selectedSale.total)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Paid ({selectedSale.paymentMethod.toUpperCase()})</span>
                  <span className="font-mono tabular-nums">
                    {formatBDT(selectedSale.paidAmount)}
                  </span>
                </div>
                {selectedSale.dueAmount > 0 && (
                  <div className="flex justify-between text-warning font-medium">
                    <span>Remaining Baki Due</span>
                    <span className="font-mono tabular-nums">
                      {formatBDT(selectedSale.dueAmount)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
              {canReturn &&
              selectedSale.paymentStatus === 'paid' &&
              !selectedSale.isReturned ? (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={returnMutation.isPending}
                  onClick={() => returnMutation.mutate(selectedSale._id)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {returnMutation.isPending ? 'Restocking...' : 'Return & Restock'}
                </Button>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {selectedSale.isReturned ? 'Sale returned & restocked' : ''}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" />
                  Print Invoice
                </Button>
                <Button size="sm" onClick={() => setSelectedSale(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
