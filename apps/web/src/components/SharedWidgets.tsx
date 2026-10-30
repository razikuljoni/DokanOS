import React from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, Download, Inbox } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { PaginationMeta, PlanType } from '@dokanos/shared';

export function PlanBadge({ plan }: { plan: PlanType }): React.ReactElement {
  return (
    <span
      className={cn(
        'text-xs font-mono uppercase tracking-wider font-semibold',
        plan === 'pro' ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {plan === 'pro' ? 'PRO PLAN' : 'FREE PLAN'}
    </span>
  );
}

export interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  tone?: 'default' | 'primary' | 'warning' | 'danger';
  loading?: boolean;
}

export function StatCard({
  label,
  value,
  subtext,
  tone = 'default',
  loading = false,
}: StatCardProps): React.ReactElement {
  const toneClass =
    tone === 'primary'
      ? 'text-primary'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'danger'
          ? 'text-destructive'
          : 'text-foreground';

  return (
    <Card className="p-5 flex flex-col justify-between">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {loading ? (
        <div className="space-y-2 mt-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ) : (
        <div className="mt-2 space-y-1">
          <div className={cn('font-display text-2xl sm:text-3xl font-bold tabular-nums', toneClass)}>
            {value}
          </div>
          {subtext && <div className="text-xs text-muted-foreground">{subtext}</div>}
        </div>
      )}
    </Card>
  );
}

export function ChartCard({
  title,
  description,
  action,
  children,
  loading = false,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  loading?: boolean;
}): React.ReactElement {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardHeader>
      <CardContent className="flex-1 pt-2">
        {loading ? <Skeleton className="h-64 w-full" /> : children}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactElement {
  return (
    <div className="py-12 px-6 text-center border border-dashed border-border rounded-md bg-secondary/30 flex flex-col items-center justify-center space-y-3">
      <Inbox className="h-6 w-6 text-muted-foreground" />
      <div className="space-y-1 max-w-md">
        <h4 className="font-display text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {actionLabel && onAction && (
        <Button size="sm" variant="outline" onClick={onAction} className="mt-1">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function LowStockBanner({ count }: { count: number }): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <div className="rounded-md border border-border bg-secondary px-4 py-3 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2.5 text-xs">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
        <span className="font-medium text-foreground tabular-nums">
          {count} product{count === 1 ? ' is' : 's are'} at or below the low-stock reorder threshold.
        </span>
      </div>
      <Link
        to="/app/products?stockStatus=low"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline whitespace-nowrap shrink-0"
      >
        Review low-stock ledger
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement | null {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-md max-w-md w-full p-6 space-y-4">
        <div className="space-y-1.5">
          <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription = 'Adjust your filters or add a new entry to populate the ledger.',
  meta,
  onPageChange,
  onExportCsv,
}: {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  meta?: PaginationMeta;
  onPageChange?: (page: number) => void;
  onExportCsv?: () => void;
}): React.ReactElement {
  if (loading) {
    return (
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-9 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border bg-secondary/60 text-xs font-medium text-muted-foreground">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'py-2.5 px-4 font-medium whitespace-nowrap',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((row) => (
              <tr
                key={rowKey(row)}
                className="hover:bg-secondary/40 transition-colors h-10"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'py-2.5 px-4 align-middle',
                      col.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(meta || onExportCsv) && (
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {meta && (
              <span className="tabular-nums">
                Showing page {meta.page} of {meta.totalPages} ({meta.total} total entries)
              </span>
            )}
            {onExportCsv && (
              <Button variant="outline" size="sm" onClick={onExportCsv}>
                <Download className="h-3.5 w-3.5" />
                Download CSV
              </Button>
            )}
          </div>
          {meta && onPageChange && meta.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page <= 1}
                onClick={() => onPageChange(meta.page - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page >= meta.totalPages}
                onClick={() => onPageChange(meta.page + 1)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
