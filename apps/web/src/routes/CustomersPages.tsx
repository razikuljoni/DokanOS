import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Edit2,
  Eye,
  Phone,
  Plus,
  Receipt,
  Search,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, StatCard, type DataTableColumn } from '@/components/SharedWidgets';
import { formatBDT, formatDateDhaka } from '@/lib/utils';

export interface CustomerRow {
  _id: string;
  name: string;
  phone: string;
  address?: string;
  balanceDue: number;
  totalSpent: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetailResponse extends CustomerRow {
  sales: Array<{
    _id: string;
    invoiceNo: string;
    total: number;
    paidAmount: number;
    dueAmount: number;
    paymentMethod: string;
    paymentStatus: string;
    createdAt: string;
  }>;
  openDues: Array<{
    _id: string;
    invoiceNo: string;
    total: number;
    paidAmount: number;
    dueAmount: number;
    createdAt: string;
  }>;
}

export function CustomersPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [filterDue, setFilterDue] = useState<'all' | 'due' | 'clear'>('all');

  // Dialog states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRow | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Detail Modal state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const { data: customersRes, isLoading } = useQuery({
    queryKey: ['customers', tenant?.id, search, filterDue],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (filterDue === 'due') params.set('hasDue', 'true');
      return apiFetch<{ data: CustomerRow[]; meta: { total: number } }>(
        `/api/v1/customers?${params.toString()}`,
      );
    },
    enabled: Boolean(tenant?.id),
  });

  const { data: customerDetailRes, isLoading: isDetailLoading } = useQuery({
    queryKey: ['customer-detail', tenant?.id, selectedCustomerId],
    queryFn: () =>
      apiFetch<{ data: CustomerDetailResponse }>(`/api/v1/customers/${selectedCustomerId}`),
    enabled: Boolean(tenant?.id && selectedCustomerId),
  });

  const customers = customersRes?.data ?? [];

  const totalBalanceDue = customers.reduce((sum, c) => sum + (c.balanceDue || 0), 0);
  const totalSpend = customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
  const customersWithDue = customers.filter((c) => (c.balanceDue || 0) > 0).length;

  const saveMutation = useMutation({
    mutationFn: async () => {
      setFormError(null);
      if (!formName.trim() || formName.trim().length < 2) {
        throw new Error('Customer name must be at least 2 characters');
      }
      if (!formPhone.trim() || formPhone.trim().length < 6) {
        throw new Error('Valid phone number is required (min 6 digits)');
      }

      if (editingCustomer) {
        return apiFetch<{ data: CustomerRow }>(`/api/v1/customers/${editingCustomer._id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formName.trim(),
            phone: formPhone.trim(),
            address: formAddress.trim(),
          }),
        });
      }

      return apiFetch<{ data: CustomerRow }>('/api/v1/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: formName.trim(),
          phone: formPhone.trim(),
          address: formAddress.trim(),
        }),
      });
    },
    onSuccess: (res) => {
      setIsFormOpen(false);
      setEditingCustomer(null);
      setFormName('');
      setFormPhone('');
      setFormAddress('');
      void queryClient.invalidateQueries({ queryKey: ['customers', tenant?.id] });
      addToast({
        title: editingCustomer ? 'Customer Updated' : 'Customer Added',
        description: `${res.data.name} saved to ledger.`,
        variant: 'success',
      });
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Could not save customer');
    },
  });

  const openCreateDialog = (): void => {
    setEditingCustomer(null);
    setFormName('');
    setFormPhone('');
    setFormAddress('');
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditDialog = (cust: CustomerRow): void => {
    setEditingCustomer(cust);
    setFormName(cust.name);
    setFormPhone(cust.phone);
    setFormAddress(cust.address || '');
    setFormError(null);
    setIsFormOpen(true);
  };

  const filteredCustomers = customers.filter((cust) => {
    if (filterDue === 'due') return cust.balanceDue > 0;
    if (filterDue === 'clear') return cust.balanceDue === 0;
    return true;
  });

  const columns: DataTableColumn<CustomerRow>[] = [
    {
      key: 'name',
      header: 'Customer',
      render: (r: CustomerRow) => (
        <div>
          <div className="font-semibold text-foreground">{r.name}</div>
          <div className="text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Phone className="h-3 w-3" />
            {r.phone}
          </div>
        </div>
      ),
    },
    {
      key: 'address',
      header: 'Address',
      render: (r: CustomerRow) => (
        <span className="text-xs text-muted-foreground">{r.address || '—'}</span>
      ),
    },
    {
      key: 'balanceDue',
      header: 'Open Baki Due',
      align: 'right',
      render: (r: CustomerRow) => (
        <span
          className={`font-mono font-bold tabular-nums text-sm ${
            r.balanceDue > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
          }`}
        >
          {formatBDT(r.balanceDue)}
        </span>
      ),
    },
    {
      key: 'totalSpent',
      header: 'Total Spent',
      align: 'right',
      render: (r: CustomerRow) => (
        <span className="font-mono tabular-nums text-xs text-foreground">
          {formatBDT(r.totalSpent)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r: CustomerRow) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelectedCustomerId(r._id)}
            className="h-8 gap-1 text-xs"
          >
            <Eye className="h-3.5 w-3.5 text-primary" />
            Ledger
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => openEditDialog(r)}
            className="h-8 w-8 p-0"
          >
            <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      ),
    },
  ];

  const detail = customerDetailRes?.data;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Customers &amp; Baki Accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Customer directory, individual credit balances, and full POS purchase history.
          </p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          New Customer
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Customers"
          value={String(customersRes?.meta.total ?? customers.length)}
          subtext={`${customersWithDue} with outstanding Baki`}
        />
        <StatCard
          label="Outstanding Baki Due"
          value={formatBDT(totalBalanceDue)}
          subtext="Customer receivable balance"
          tone={totalBalanceDue > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Lifetime Revenue"
          value={formatBDT(totalSpend)}
          subtext="Cumulative sales to registered customers"
          tone="primary"
        />
      </div>

      {/* Filter and Search Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <Button
                variant={filterDue === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterDue('all')}
              >
                All
              </Button>
              <Button
                variant={filterDue === 'due' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterDue('due')}
                className="gap-1.5"
              >
                <span>With Due</span>
                {customersWithDue > 0 && (
                  <span className="rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.2 text-[10px] font-mono">
                    {customersWithDue}
                  </span>
                )}
              </Button>
              <Button
                variant={filterDue === 'clear' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterDue('clear')}
              >
                Paid Off
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Customers Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Customer Directory</CardTitle>
          <CardDescription className="text-xs">
            Customers linked automatically during POS sales or added manually.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<CustomerRow>
            columns={columns}
            data={filteredCustomers}
            rowKey={(r) => r._id}
            loading={isLoading}
            emptyTitle="No customers found"
            emptyDescription="Adjust your filters or add a new customer to populate the ledger."
          />
        </CardContent>
      </Card>

      {/* Add / Edit Customer Dialog */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="max-w-md w-full shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-3 space-y-0">
              <CardTitle className="text-lg">
                {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setIsFormOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {formError && (
                <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive text-xs text-destructive flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveMutation.mutate();
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="cust-name">Full Name *</Label>
                  <Input
                    id="cust-name"
                    placeholder="e.g. Rafiqul Islam"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cust-phone">Phone Number *</Label>
                  <Input
                    id="cust-phone"
                    placeholder="e.g. 01712345678"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cust-address">Address / Notes</Label>
                  <Input
                    id="cust-address"
                    placeholder="e.g. House 4, Road 2, Mirpur"
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsFormOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? 'Saving...' : 'Save Customer'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Customer Detail / Ledger Modal */}
      {selectedCustomerId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-3 space-y-0 shrink-0">
              <div className="space-y-1">
                <CardTitle className="text-xl flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-primary" />
                  <span>{detail?.name ?? 'Loading Customer...'}</span>
                </CardTitle>
                <div className="text-xs text-muted-foreground flex items-center gap-3 font-mono">
                  <span>Phone: {detail?.phone}</span>
                  {detail?.address && <span>· Address: {detail?.address}</span>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setSelectedCustomerId(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>

            <CardContent className="overflow-y-auto pt-4 space-y-6">
              {isDetailLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Loading customer ledger...
                </div>
              ) : !detail ? (
                <div className="py-12 text-center text-sm text-destructive">
                  Customer record not found.
                </div>
              ) : (
                <>
                  {/* Ledger Balance Highlights */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-border bg-secondary/30">
                      <div className="text-xs text-muted-foreground">Outstanding Baki Due</div>
                      <div
                        className={`text-2xl font-bold font-mono mt-1 ${
                          detail.balanceDue > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-foreground'
                        }`}
                      >
                        {formatBDT(detail.balanceDue)}
                      </div>
                    </div>
                    <div className="p-4 rounded-xl border border-border bg-secondary/30">
                      <div className="text-xs text-muted-foreground">Total Lifetime Spend</div>
                      <div className="text-2xl font-bold font-mono mt-1 text-foreground">
                        {formatBDT(detail.totalSpent)}
                      </div>
                    </div>
                  </div>

                  {/* Open Dues Section */}
                  {detail.openDues.length > 0 && (
                    <div className="space-y-2.5">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                        <span>Unpaid Baki Invoices ({detail.openDues.length})</span>
                      </h3>
                      <div className="border rounded-lg overflow-hidden divide-y">
                        {detail.openDues.map((due) => (
                          <div
                            key={due._id}
                            className="p-3 flex items-center justify-between text-xs bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
                          >
                            <div>
                              <div className="font-mono font-bold text-foreground">
                                {due.invoiceNo}
                              </div>
                              <div className="text-muted-foreground">
                                {formatDateDhaka(due.createdAt)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono font-bold text-amber-600 dark:text-amber-400">
                                Due: {formatBDT(due.dueAmount)}
                              </div>
                              <div className="text-muted-foreground font-mono">
                                Total: {formatBDT(due.total)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Purchase History */}
                  <div className="space-y-2.5">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-primary" />
                      <span>Recent Sales ({detail.sales.length})</span>
                    </h3>
                    {detail.sales.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted-foreground border rounded-lg">
                        No sales recorded for this customer yet.
                      </div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden divide-y">
                        {detail.sales.map((sale) => (
                          <div
                            key={sale._id}
                            className="p-3 flex items-center justify-between text-xs hover:bg-secondary/40 transition-colors"
                          >
                            <div className="space-y-0.5">
                              <div className="font-mono font-semibold text-foreground flex items-center gap-2">
                                <span>{sale.invoiceNo}</span>
                                <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded border bg-secondary">
                                  {sale.paymentMethod}
                                </span>
                              </div>
                              <div className="text-muted-foreground">
                                {formatDateDhaka(sale.createdAt)}
                              </div>
                            </div>
                            <div className="text-right space-y-0.5">
                              <div className="font-mono font-bold text-foreground">
                                {formatBDT(sale.total)}
                              </div>
                              <div
                                className={`text-[11px] font-mono ${
                                  sale.dueAmount > 0
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-emerald-600 dark:text-emerald-400'
                                }`}
                              >
                                {sale.dueAmount > 0
                                  ? `Due ${formatBDT(sale.dueAmount)}`
                                  : 'Paid Full'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
