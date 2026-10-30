import React from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  ChartCard,
  DataTable,
  LowStockBanner,
  StatCard,
  type DataTableColumn,
} from '@/components/SharedWidgets';
import { formatBDT, formatDateDhaka } from '@/lib/utils';

interface DashboardSummary {
  revenue: number;
  profit: number;
  salesCount: number;
  averageBill: number;
  topProducts: Array<{
    productId: string;
    name: string;
    qtySold: number;
    revenue: number;
  }>;
  salesByCategory: Array<{
    category: string;
    revenue: number;
    count: number;
  }>;
  lowStockCount: number;
  duesOutstanding: {
    receivable: number;
    payable: number;
  };
  recentSales: Array<{
    _id: string;
    invoiceNo: string;
    customerName: string;
    paymentMethod: string;
    paymentStatus: string;
    total: number;
    dueAmount: number;
    createdAt: string;
  }>;
}

interface SalesTrendPoint {
  date: string;
  revenue: number;
  orders: number;
}

const CHART_COLORS = ['#14532D', '#B45309', '#57534E', '#1C1917', '#78716C'];

export function DashboardPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);

  const { data: summaryRes, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboard', tenant?.id, 'summary'],
    queryFn: () => apiFetch<{ data: DashboardSummary }>('/api/v1/dashboard/summary'),
    enabled: Boolean(tenant?.id),
  });

  const { data: trendRes, isLoading: trendLoading } = useQuery({
    queryKey: ['dashboard', tenant?.id, 'trend'],
    queryFn: () => apiFetch<{ data: SalesTrendPoint[] }>('/api/v1/dashboard/sales-trend'),
    enabled: Boolean(tenant?.id),
  });

  const summary = summaryRes?.data;
  const trend = trendRes?.data ?? [];

  const recentSaleColumns: DataTableColumn<DashboardSummary['recentSales'][number]>[] = [
    {
      key: 'invoiceNo',
      header: 'Invoice',
      render: (row) => (
        <span className="font-mono text-xs font-medium text-foreground">{row.invoiceNo}</span>
      ),
    },
    {
      key: 'customerName',
      header: 'Customer',
      render: (row) => <span>{row.customerName}</span>,
    },
    {
      key: 'payment',
      header: 'Method / Status',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.paymentMethod.toUpperCase()} ·{' '}
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
      header: 'Total (BDT)',
      align: 'right',
      render: (row) => (
        <span className="font-mono font-semibold tabular-nums">{formatBDT(row.total)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {tenant?.name ?? 'Shop'} Ledger Overview
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time aggregation across POS counter sales, stock movements, and Baki dues ·{' '}
            <span className="tabular-nums">{formatDateDhaka(new Date())}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/app/products">
            <Button variant="outline" size="sm">
              Stock Ledger
            </Button>
          </Link>
          <Link to="/app/sales/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              Open POS Terminal
            </Button>
          </Link>
        </div>
      </div>

      {/* Low Stock Banner */}
      {summary && <LowStockBanner count={summary.lowStockCount} />}

      {/* 4 KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue (30d)"
          value={formatBDT(summary?.revenue ?? 0)}
          subtext={`${summary?.salesCount ?? 0} completed invoices`}
          loading={summaryLoading}
        />
        <StatCard
          label="Net Profit (Revenue − COGS)"
          value={formatBDT(summary?.profit ?? 0)}
          subtext={`Avg bill ${formatBDT(summary?.averageBill ?? 0)}`}
          tone="primary"
          loading={summaryLoading}
        />
        <StatCard
          label="Customer Baki Receivable"
          value={formatBDT(summary?.duesOutstanding.receivable ?? 0)}
          subtext="Owed to shop by customers"
          tone={(summary?.duesOutstanding.receivable ?? 0) > 0 ? 'warning' : 'default'}
          loading={summaryLoading}
        />
        <StatCard
          label="Supplier Baki Payable"
          value={formatBDT(summary?.duesOutstanding.payable ?? 0)}
          subtext={`${summary?.lowStockCount ?? 0} low-stock items to reorder`}
          tone={(summary?.lowStockCount ?? 0) > 0 ? 'danger' : 'default'}
          loading={summaryLoading}
        />
      </div>

      {/* Charts Row: Daily Revenue Line Chart + Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <ChartCard
            title="Daily Revenue Trend (BDT)"
            description="30-day counter sales aggregated by Asia/Dhaka date"
            loading={trendLoading}
          >
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E0D4" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#57534E' }}
                    tickFormatter={(val: string) => val.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#57534E' }}
                    tickFormatter={(val: number) => `৳${val}`}
                  />
                  <Tooltip
                    formatter={(value: number) => [`৳${value.toLocaleString()}`, 'Revenue']}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#14532D"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <div className="lg:col-span-4">
          <ChartCard
            title="Sales by Category"
            description="Revenue distribution by product department"
            loading={summaryLoading}
          >
            <div className="h-64 w-full flex flex-col justify-between">
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={summary?.salesByCategory ?? []}
                      dataKey="revenue"
                      nameKey="category"
                      innerRadius={42}
                      outerRadius={68}
                      paddingAngle={2}
                    >
                      {(summary?.salesByCategory ?? []).map((entry, idx) => (
                        <Cell
                          key={entry.category}
                          fill={CHART_COLORS[idx % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [`৳${value.toLocaleString()}`, 'Revenue']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1 text-xs">
                {(summary?.salesByCategory ?? []).slice(0, 4).map((cat, idx) => (
                  <div key={cat.category} className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {idx + 1}. {cat.category}
                    </span>
                    <span className="font-mono tabular-nums font-medium">
                      {formatBDT(cat.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </ChartCard>
        </div>
      </div>

      {/* Bottom Row: Top 5 Products BarChart + Recent Sales Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5">
          <ChartCard
            title="Top 5 Products by Revenue"
            description="Highest-grossing SKUs in the current period"
            loading={summaryLoading}
          >
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={summary?.topProducts ?? []}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E0D4" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: '#57534E' }}
                    tickFormatter={(v: number) => `৳${v}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={130}
                    tick={{ fontSize: 11, fill: '#1C1917' }}
                  />
                  <Tooltip
                    formatter={(value: number) => [`৳${value.toLocaleString()}`, 'Revenue']}
                  />
                  <Bar dataKey="revenue" fill="#14532D" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold">Recent POS Invoices</h2>
              <p className="text-xs text-muted-foreground">
                Latest counter transactions recorded in this shop
              </p>
            </div>
            <Link
              to="/app/sales"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              View all sales
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <DataTable
            columns={recentSaleColumns}
            data={summary?.recentSales ?? []}
            rowKey={(r) => r._id}
            loading={summaryLoading}
          />
        </div>
      </div>
    </div>
  );
}
