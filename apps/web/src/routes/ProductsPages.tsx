import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft,
  CloudOff,
  Download,
  Edit3,
  Eye,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  PRODUCT_UNITS,
  createProductSchema,
  type CreateProductInput,
  type PaginationMeta,
} from '@dokanos/shared';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useIsOffline } from '@/stores/offlineStore';
import { ApiClientError, apiFetch } from '@/lib/api';
import { getTenantSnapshot, saveTenantSnapshot } from '@/lib/offlineCache';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog, DataTable, type DataTableColumn } from '@/components/SharedWidgets';
import { formatBDT, formatDateDhaka } from '@/lib/utils';

interface ProductRow {
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

export function ProductsListPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const user = useAuthStore((s) => s.user);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isOffline = useIsOffline();
  const canWrite = (user?.role === 'owner' || user?.role === 'manager') && !isOffline;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [stockStatus, setStockStatus] = useState(searchParams.get('stockStatus') ?? 'all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvContent, setCsvContent] = useState(
    'name,category,unit,sku,costPrice,sellPrice,stock,lowStockAt\nNapa Extend 665mg,Medicine,strip,MED-901,18,24,60,12',
  );

  const { data, isLoading } = useQuery({
    queryKey: ['products', tenant?.id, { page, search, stockStatus, mode: isOffline ? 'offline' : 'online' }],
    queryFn: async (): Promise<{ data: ProductRow[]; meta?: PaginationMeta; fromCache?: boolean }> => {
      if (!tenant?.id) return { data: [] };

      if (isOffline) {
        const snap = await getTenantSnapshot<ProductRow[]>(tenant.id, 'pos-products');
        const list = (snap?.data ?? []).filter((p) => {
          if (stockStatus === 'low' && !(p.stock > 0 && p.stock <= p.lowStockAt)) return false;
          if (stockStatus === 'out' && p.stock !== 0) return false;
          if (!search.trim()) return true;
          const q = search.trim().toLowerCase();
          return (
            p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q)
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
        if (stockStatus !== 'all') params.set('stockStatus', stockStatus);
        const res = await apiFetch<{ data: ProductRow[]; meta: PaginationMeta }>(
          `/api/v1/products?${params.toString()}`,
        );
        if (page === 1 && !search.trim() && stockStatus === 'all') {
          await saveTenantSnapshot(tenant.id, 'pos-products', res.data);
        }
        return { ...res, fromCache: false };
      } catch (err) {
        if (!(err instanceof ApiClientError)) {
          const snap = await getTenantSnapshot<ProductRow[]>(tenant.id, 'pos-products');
          if (snap) {
            return { data: snap.data, fromCache: true };
          }
        }
        throw err;
      }
    },
    enabled: Boolean(tenant?.id),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateProductInput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      name: '',
      category: 'Medicine',
      unit: 'box',
      sku: '',
      costPrice: 0,
      sellPrice: 0,
      stock: 0,
      lowStockAt: 10,
    },
  });

  const openCreateDrawer = (): void => {
    setEditingProduct(null);
    reset({
      name: '',
      category: 'Medicine',
      unit: 'box',
      sku: `SKU-${Math.floor(100 + Math.random() * 900)}`,
      costPrice: 100,
      sellPrice: 130,
      stock: 25,
      lowStockAt: tenant?.settings.lowStockThreshold ?? 10,
    });
    setDrawerOpen(true);
  };

  const openEditDrawer = (prod: ProductRow): void => {
    setEditingProduct(prod);
    reset({
      name: prod.name,
      category: prod.category,
      unit: prod.unit,
      sku: prod.sku,
      costPrice: prod.costPrice,
      sellPrice: prod.sellPrice,
      stock: prod.stock,
      lowStockAt: prod.lowStockAt,
    });
    setDrawerOpen(true);
  };

  const onSaveProduct = async (values: CreateProductInput): Promise<void> => {
    try {
      if (editingProduct) {
        await apiFetch(`/api/v1/products/${editingProduct._id}`, {
          method: 'PATCH',
          body: JSON.stringify(values),
        });
        addToast({ title: 'Product Updated', description: values.name, variant: 'success' });
      } else {
        await apiFetch('/api/v1/products', {
          method: 'POST',
          body: JSON.stringify(values),
        });
        addToast({ title: 'Product Created', description: values.name, variant: 'success' });
      }
      setDrawerOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant?.id] });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'PLAN_LIMIT') {
        addToast({
          title: 'Plan Limit Reached',
          description: err.message,
          variant: 'warning',
        });
        void navigate('/app/billing');
        return;
      }
      addToast({
        title: 'Save Failed',
        description: err instanceof Error ? err.message : 'Could not save product',
        variant: 'danger',
      });
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/v1/products/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant?.id] });
      addToast({ title: 'Product Archived', variant: 'success' });
    },
  });

  const handleExportCsv = async (): Promise<void> => {
    if (tenant?.plan !== 'pro') {
      addToast({
        title: 'Pro Plan Required',
        description: 'CSV Export is unlocked on DokanOS Pro (৳499/mo).',
        variant: 'warning',
      });
      void navigate('/app/billing');
      return;
    }

    try {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch('/api/v1/products/export', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dokanos-stock-${tenant.slug}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast({
        title: 'Export Failed',
        description: err instanceof Error ? err.message : 'Unable to export CSV',
        variant: 'danger',
      });
    }
  };

  const handleImportCsv = async (): Promise<void> => {
    try {
      const res = await apiFetch<{
        data: { importedCount: number; totalRows: number; errors: Array<{ row: number; message: string }> };
      }>('/api/v1/products/import', {
        method: 'POST',
        body: JSON.stringify({ csv: csvContent }),
      });
      setCsvModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
      addToast({
        title: 'CSV Import Complete',
        description: `Imported ${res.data.importedCount} of ${res.data.totalRows} row(s).`,
        variant: 'success',
      });
    } catch (err) {
      addToast({
        title: 'CSV Import Failed',
        description: err instanceof Error ? err.message : 'Check CSV format or upgrade to Pro',
        variant: 'danger',
      });
    }
  };

  const columns: DataTableColumn<ProductRow>[] = [
    {
      key: 'sku',
      header: 'SKU',
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.sku}</span>,
    },
    {
      key: 'name',
      header: 'Product Name',
      render: (row) => (
        <Link
          to={`/app/products/${row._id}`}
          className="font-medium text-foreground hover:text-primary hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'category',
      header: 'Category · Unit',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.category} · {row.unit}
        </span>
      ),
    },
    {
      key: 'costPrice',
      header: 'Cost (BDT)',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatBDT(row.costPrice)}
        </span>
      ),
    },
    {
      key: 'sellPrice',
      header: 'Sell Price',
      align: 'right',
      render: (row) => (
        <span className="font-mono font-semibold tabular-nums">{formatBDT(row.sellPrice)}</span>
      ),
    },
    {
      key: 'stock',
      header: 'Stock Balance',
      align: 'right',
      render: (row) => {
        const isLow = row.stock <= row.lowStockAt;
        return (
          <span
            className={`font-mono font-semibold tabular-nums ${
              row.stock === 0
                ? 'text-destructive'
                : isLow
                  ? 'text-warning'
                  : 'text-foreground'
            }`}
          >
            {row.stock} {row.unit}
            {isLow ? ' (Low)' : ''}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="inline-flex items-center gap-1">
          <Link to={`/app/products/${row._id}`}>
            <Button variant="ghost" size="sm" title="Stock Movement Ledger">
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </Link>
          {canWrite && (
            <>
              <Button variant="ghost" size="sm" onClick={() => openEditDrawer(row)}>
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(row)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Products & Stock Ledger
          </h1>
          <p className="text-xs text-muted-foreground">
            Per-tenant SKU inventory with reorder thresholds and append-only stock movement tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleExportCsv()}>
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          {canWrite && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (tenant?.plan !== 'pro') {
                    addToast({
                      title: 'Pro Plan Required',
                      description: 'Bulk CSV Import is a Pro feature.',
                      variant: 'warning',
                    });
                    void navigate('/app/billing');
                    return;
                  }
                  setCsvModalOpen(true);
                }}
              >
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </Button>
              <Button size="sm" onClick={openCreateDrawer}>
                <Plus className="h-3.5 w-3.5" />
                Add Product
              </Button>
            </>
          )}
        </div>
      </div>

      {(isOffline || data?.fromCache) && (
        <div className="rounded-md border border-warning/40 bg-warning/15 px-4 py-2.5 flex items-center gap-2 text-xs font-medium text-warning">
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>Offline — showing cached data</span>
        </div>
      )}

      {/* Search & Stock Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by product name, SKU, or category..."
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-secondary rounded-md">
          {(
            [
              { id: 'all', label: 'All Stock' },
              { id: 'low', label: 'Low Stock' },
              { id: 'out', label: 'Out of Stock' },
              { id: 'ok', label: 'Healthy' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setStockStatus(f.id);
                setSearchParams(f.id === 'all' ? {} : { stockStatus: f.id });
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                stockStatus === f.id
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
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
        onExportCsv={() => void handleExportCsv()}
      />

      {/* Add / Edit Product Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-end">
          <div className="bg-card border-l border-border h-full max-w-md w-full p-6 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h3 className="font-display text-lg font-bold">
                  {editingProduct ? 'Edit Product' : 'Add New Product'}
                </h3>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="p-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form
                id="product-form"
                onSubmit={(e) => void handleSubmit(onSaveProduct)(e)}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="p-name">Product Name</Label>
                  <Input id="p-name" {...register('name')} />
                  {errors.name && (
                    <p className="text-xs text-destructive">{errors.name.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="p-sku">SKU (Unique per shop)</Label>
                    <Input id="p-sku" {...register('sku')} className="font-mono" />
                    {errors.sku && (
                      <p className="text-xs text-destructive">{errors.sku.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-category">Category</Label>
                    <Input id="p-category" {...register('category')} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="p-unit">Unit</Label>
                    <select
                      id="p-unit"
                      {...register('unit')}
                      className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                    >
                      {PRODUCT_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-cost">Cost (৳)</Label>
                    <Input
                      id="p-cost"
                      type="number"
                      step="0.01"
                      {...register('costPrice', { valueAsNumber: true })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-sell">Sell (৳)</Label>
                    <Input
                      id="p-sell"
                      type="number"
                      step="0.01"
                      {...register('sellPrice', { valueAsNumber: true })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="p-stock">Opening Stock</Label>
                    <Input
                      id="p-stock"
                      type="number"
                      disabled={Boolean(editingProduct)}
                      {...register('stock', { valueAsNumber: true })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-low">Low-Stock Alert At</Label>
                    <Input
                      id="p-low"
                      type="number"
                      {...register('lowStockAt', { valueAsNumber: true })}
                    />
                  </div>
                </div>
              </form>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setDrawerOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" form="product-form" size="sm" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Product'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {csvModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-md max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Bulk CSV Product Import (Pro)</h3>
              <button
                type="button"
                onClick={() => setCsvModalOpen(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste CSV rows with columns:{' '}
              <code>name,category,unit,sku,costPrice,sellPrice,stock,lowStockAt</code>
            </p>
            <textarea
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-input bg-secondary/40 p-3 font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCsvModalOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handleImportCsv()}>
                Import Products
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Archive Product"
        description={`Are you sure you want to soft-delete "${deleteTarget?.name}" from active stock? Historical sales remain intact.`}
        confirmLabel="Archive Product"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget._id);
        }}
      />
    </div>
  );
}

// /app/products/:id — Product Detail + Stock Movements Ledger + Manual Stock Adjustment
interface ProductDetailResponse extends ProductRow {
  movements: Array<{
    _id: string;
    type: string;
    qtyChange: number;
    balanceAfter: number;
    refType: string;
    note: string;
    createdAt: string;
  }>;
  recentSales: Array<{
    _id: string;
    invoiceNo: string;
    customerName: string;
    total: number;
    createdAt: string;
  }>;
}

export function ProductDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const tenant = useAuthStore((s) => s.tenant);
  const user = useAuthStore((s) => s.user);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const canAdjust = user?.role === 'owner' || user?.role === 'manager';
  const [qtyChange, setQtyChange] = useState<number>(5);
  const [note, setNote] = useState('Physical shelf count adjustment');

  const { data, isLoading } = useQuery({
    queryKey: ['products', tenant?.id, id],
    queryFn: () => apiFetch<{ data: ProductDetailResponse }>(`/api/v1/products/${id}`),
    enabled: Boolean(tenant?.id && id),
  });

  const adjustMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/v1/stock/adjust', {
        method: 'POST',
        body: JSON.stringify({
          productId: id,
          qtyChange,
          note,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products', tenant?.id, id] });
      void queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant?.id] });
      addToast({
        title: 'Stock Adjusted',
        description: `Recorded ${qtyChange > 0 ? `+${qtyChange}` : qtyChange} movement.`,
        variant: 'success',
      });
    },
    onError: (err) => {
      addToast({
        title: 'Adjustment Failed',
        description: err instanceof Error ? err.message : 'Unable to adjust stock',
        variant: 'danger',
      });
    },
  });

  const product = data?.data;

  if (isLoading || !product) {
    return <div className="text-sm text-muted-foreground">Loading product ledger...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            to="/app/products"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Products Ledger
          </Link>
          <h1 className="font-display text-2xl font-bold tracking-tight">{product.name}</h1>
          <div className="text-xs text-muted-foreground">
            <span>SKU: {product.sku}</span>
            <span aria-hidden="true"> · </span>
            <span>{product.category}</span>
            <span aria-hidden="true"> · </span>
            <span>Unit: {product.unit}</span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-muted-foreground">Current Stock Balance</div>
          <div className="font-display text-3xl font-bold tabular-nums text-primary">
            {product.stock} {product.unit}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Append-Only Stock Movements Ledger</CardTitle>
              <CardDescription>
                Every sale, purchase, return, and manual adjustment recorded for this SKU.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/60 border-b border-border text-muted-foreground">
                      <th className="py-2 px-3 text-left">Date</th>
                      <th className="py-2 px-3 text-left">Type / Note</th>
                      <th className="py-2 px-3 text-right">Change</th>
                      <th className="py-2 px-3 text-right">Balance After</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {product.movements.map((m) => (
                      <tr key={m._id}>
                        <td className="py-2 px-3 tabular-nums text-muted-foreground">
                          {formatDateDhaka(m.createdAt)}
                        </td>
                        <td className="py-2 px-3">
                          <span className="uppercase font-medium">{m.type}</span> · {m.note}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono font-semibold tabular-nums ${
                            m.qtyChange > 0 ? 'text-primary' : 'text-destructive'
                          }`}
                        >
                          {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {m.balanceAfter}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-5 space-y-4">
          {canAdjust && (
            <Card>
              <CardHeader>
                <CardTitle>Manual Stock Adjustment</CardTitle>
                <CardDescription>
                  Record damaged units or physical count corrections with a required audit note.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="adj-qty" className="text-xs">
                    Quantity Change (positive to add, negative to deduct)
                  </Label>
                  <Input
                    id="adj-qty"
                    type="number"
                    value={qtyChange}
                    onChange={(e) => setQtyChange(Number(e.target.value))}
                    className="font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="adj-note" className="text-xs">
                    Audit Note (Required)
                  </Label>
                  <Input
                    id="adj-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={adjustMutation.isPending || qtyChange === 0 || note.trim().length < 3}
                  onClick={() => adjustMutation.mutate()}
                >
                  {adjustMutation.isPending ? 'Recording...' : 'Record Stock Adjustment'}
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Recent Invoices Containing {product.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {product.recentSales.length === 0 ? (
                <div className="text-muted-foreground">No recent sales for this product.</div>
              ) : (
                product.recentSales.map((s) => (
                  <div
                    key={s._id}
                    className="flex items-center justify-between py-1.5 border-b border-border"
                  >
                    <div>
                      <span className="font-mono font-medium">{s.invoiceNo}</span> ·{' '}
                      <span className="text-muted-foreground">{s.customerName}</span>
                    </div>
                    <span className="font-mono tabular-nums font-semibold">
                      {formatBDT(s.total)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
