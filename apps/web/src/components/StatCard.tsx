import React from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

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
