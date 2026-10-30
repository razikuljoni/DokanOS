import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/SharedWidgets';
import { formatBDT, formatDateDhaka } from '@/lib/utils';

interface SupplierRow {
  _id: string;
  name: string;
  phone: string;
  address: string;
  totalDue: number;
}

interface PurchaseRow {
  _id: string;
  supplierId: { _id: string; name: string; phone: string } | null;
  items: Array<{ name: string; qty: number; costPrice: number; lineTotal: number }>;
  total: number;
  paidAmount: number;
  dueAmount: number;
  status: 'received' | 'partial' | 'pending';
  receivedAt: string;
}

interface ProductSimple {
  _id: string;
  name: string;
  sku: string;
  costPrice: number;
}

export function PurchasesPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState(20);
  const [costPrice, setCostPrice] = useState(120);
  const [paidAmount, setPaidAmount] = useState(1000);

  const { data: purchasesRes, isLoading } = useQuery({
    queryKey: ['purchases', tenant?.id],
    queryFn: () => apiFetch<{ data: PurchaseRow[] }>('/api/v1/purchases'),
    enabled: Boolean(tenant?.id),
  });

  const { data: suppliersRes } = useQuery({
    queryKey: ['suppliers', tenant?.id],
    queryFn: () => apiFetch<{ data: SupplierRow[] }>('/api/v1/suppliers'),
    enabled: Boolean(tenant?.id),
  });

  const { data: productsRes } = useQuery({
    queryKey: ['products', tenant?.id, 'purchase-select'],
    queryFn: () => apiFetch<{ data: ProductSimple[] }>('/api/v1/products?limit=100'),
    enabled: Boolean(tenant?.id),
  });

  const suppliers = suppliersRes?.data ?? [];
  const products = productsRes?.data ?? [];

  const createPurchaseMutation = useMutation({
    mutationFn: async () => {
      const chosenSupplier = supplierId || suppliers[0]?._id || '';
      const chosenProduct = productId || products[0]?._id || '';
      return apiFetch('/api/v1/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: chosenSupplier,
          items: [{ productId: chosenProduct, qty, costPrice }],
          paidAmount,
        }),
      });
    },
    onSuccess: () => {
      setModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['purchases', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['suppliers', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['dues', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant?.id] });
      addToast({
        title: 'Purchase Received & Stock Incremented',
        description: 'Stock movement and supplier Baki balance updated in one transaction.',
        variant: 'success',
      });
    },
    onError: (err) => {
      addToast({
        title: 'Purchase Failed',
        description: err instanceof Error ? err.message : 'Unable to record purchase',
        variant: 'danger',
      });
    },
  });

  const columns: DataTableColumn<PurchaseRow>[] = [
    {
      key: 'po',
      header: 'Purchase Ref',
      render: (row) => (
        <span className="font-mono text-xs font-semibold">
          PO-{row._id.slice(-6).toUpperCase()}
        </span>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (row) => (
        <div>
          <div className="font-medium text-foreground">{row.supplierId?.name ?? 'Supplier'}</div>
          <div className="text-xs font-mono text-muted-foreground">{row.supplierId?.phone}</div>
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Received Items',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.items.map((it) => `${it.name} (×${it.qty})`).join(', ')}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDateDhaka(row.receivedAt)}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total (BDT)',
      align: 'right',
      render: (row) => <span className="font-mono tabular-nums">{formatBDT(row.total)}</span>,
    },
    {
      key: 'due',
      header: 'Supplier Baki Due',
      align: 'right',
      render: (row) => (
        <span
          className={`font-mono font-semibold tabular-nums ${
            row.dueAmount > 0 ? 'text-warning' : 'text-primary'
          }`}
        >
          {row.dueAmount > 0 ? formatBDT(row.dueAmount) : 'Settled'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Purchase Orders & Stock Receiving
          </h1>
          <p className="text-xs text-muted-foreground">
            Receiving a supplier delivery atomically increases product stock and updates supplier
            Baki payables.
          </p>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Receive New Purchase
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={purchasesRes?.data ?? []}
        rowKey={(r) => r._id}
        loading={isLoading}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-md max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Receive Supplier Purchase</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="po-sup">Supplier</Label>
                <select
                  id="po-sup"
                  value={supplierId || suppliers[0]?._id || ''}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                >
                  {suppliers.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="po-prod">Product to Restock</Label>
                <select
                  id="po-prod"
                  value={productId || products[0]?._id || ''}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    const found = products.find((p) => p._id === e.target.value);
                    if (found) setCostPrice(found.costPrice);
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                >
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="po-qty">Quantity Received</Label>
                  <Input
                    id="po-qty"
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="po-cost">Unit Cost (৳)</Label>
                  <Input
                    id="po-cost"
                    type="number"
                    min={0}
                    value={costPrice}
                    onChange={(e) => setCostPrice(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="po-paid">
                  Amount Paid Now (৳) — Total Bill: {formatBDT(qty * costPrice)}
                </Label>
                <Input
                  id="po-paid"
                  type="number"
                  min={0}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={createPurchaseMutation.isPending}
                onClick={() => createPurchaseMutation.mutate()}
              >
                {createPurchaseMutation.isPending ? 'Receiving...' : 'Receive & Update Stock'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SuppliersPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const { data: suppliersRes, isLoading } = useQuery({
    queryKey: ['suppliers', tenant?.id],
    queryFn: () => apiFetch<{ data: SupplierRow[] }>('/api/v1/suppliers'),
    enabled: Boolean(tenant?.id),
  });

  const createSupplierMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/v1/suppliers', {
        method: 'POST',
        body: JSON.stringify({ name, phone, address }),
      });
    },
    onSuccess: () => {
      setName('');
      setPhone('');
      setAddress('');
      void queryClient.invalidateQueries({ queryKey: ['suppliers', tenant?.id] });
      addToast({ title: 'Supplier Added', variant: 'success' });
    },
    onError: (err) => {
      addToast({
        title: 'Could Not Add Supplier',
        description: err instanceof Error ? err.message : 'Check fields',
        variant: 'danger',
      });
    },
  });

  const columns: DataTableColumn<SupplierRow>[] = [
    {
      key: 'name',
      header: 'Supplier / Distributor',
      render: (row) => (
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Truck className="h-4 w-4 text-primary shrink-0" />
          <span>{row.name}</span>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (row) => <span className="font-mono text-xs">{row.phone}</span>,
    },
    {
      key: 'address',
      header: 'Address',
      render: (row) => <span className="text-xs text-muted-foreground">{row.address}</span>,
    },
    {
      key: 'totalDue',
      header: 'Total Payable (Baki)',
      align: 'right',
      render: (row) => (
        <span
          className={`font-mono font-semibold tabular-nums ${
            row.totalDue > 0 ? 'text-warning' : 'text-primary'
          }`}
        >
          {formatBDT(row.totalDue)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Suppliers & Distributors
        </h1>
        <p className="text-xs text-muted-foreground">
          Manage pharmaceutical and wholesale distributors and track outstanding supplier Baki.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8">
          <DataTable
            columns={columns}
            data={suppliersRes?.data ?? []}
            rowKey={(r) => r._id}
            loading={isLoading}
          />
        </div>

        <div className="lg:col-span-4">
          <Card>
            <CardHeader>
              <CardTitle>Add New Supplier</CardTitle>
              <CardDescription>
                Register a distributor or wholesaler for purchase orders.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="sup-name">Supplier Name</Label>
                <Input
                  id="sup-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Beximco Pharma Depot"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sup-phone">Phone Number</Label>
                <Input
                  id="sup-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01711-000000"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sup-addr">Address</Label>
                <Input
                  id="sup-addr"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Mirpur, Dhaka"
                />
              </div>
              <Button
                className="w-full"
                size="sm"
                disabled={
                  createSupplierMutation.isPending || name.trim().length < 2 || phone.trim().length < 6
                }
                onClick={() => createSupplierMutation.mutate()}
              >
                <Plus className="h-3.5 w-3.5" />
                Save Supplier
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
